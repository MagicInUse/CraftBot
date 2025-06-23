// Load environment variables from the .env file
require('dotenv').config();

// Import necessary packages
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Rcon } = require('rcon-client');
const chokidar = require('chokidar');
const fs = require('fs');

// --- LOAD CONFIGURATION ---
const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Extract global configuration with defaults
const globalConfig = config.global || {};
const BOT_TRIGGER = globalConfig.botTrigger || '@gem';
const GEMINI_MODEL = globalConfig.geminiModel || 'gemini-1.5-flash';
const BOT_NAME = globalConfig.botName || 'Gem';
const CHUNK_SIZES = globalConfig.chunkSizes || { headerChunk: 45, continuationChunk: 60 };
const DELAYS = globalConfig.delays || { regularResponse: 1000, longResponse: 2000, queueDelay: 500, helpMessageDelay: 1000 };
const RECONNECT_CONFIG = globalConfig.reconnect || { initialInterval: 15000, maxInterval: 300000 };
const STYLING = globalConfig.styling || {
    messageColor: "white",
    headerColors: { bracket: "gold", serverText: "gray", botName: "aqua", separator: "gray" },
    helpColors: { title: "light_purple", accent: "yellow", usage: "green", flags: "gold", example: "aqua", note: "orange", tip: "gold" }
};
const MESSAGES = globalConfig.messages || {
    helpTitle: "CraftBot Help Guide",
    usageExample: "Usage: {trigger} [flags] <your question>",
    exampleCommand: "'{trigger} -mc -long what is redstone?'",
    queueNote: "Public responses queue (one at a time). Use -me for instant private replies!",
    funTip: "Always ask why!",
    fallbackHelp: "CraftBot Help: Use {trigger} with your questions. Try -help for more info!"
};

// --- INITIALIZE GEMINI ---
if (!GEMINI_API_KEY || GEMINI_API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("GEMINI_API_KEY is not defined. Please check your .env file.");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// --- QUEUE SYSTEM FOR PUBLIC RESPONSES ---
// Only allow one public response at a time, but private responses (-me) bypass the queue
let isProcessingPublicResponse = false;
const responseQueue = [];

// --- QUEUE PROCESSING FUNCTION ---
// Processes the next item in the response queue
async function processQueue() {
    if (isProcessingPublicResponse || responseQueue.length === 0) {
        return;
    }
    
    isProcessingPublicResponse = true;
    const { rconConnection, serverName, chunks, isLongRequest } = responseQueue.shift();
    
    try {
        await sendOptimizedChunks(rconConnection, serverName, chunks, isLongRequest);
    } catch (error) {
        console.error(`[${serverName}] Error processing queued response:`, error);
    } finally {        isProcessingPublicResponse = false;
        // Process next item in queue if any
        if (responseQueue.length > 0) {
            setTimeout(processQueue, DELAYS.queueDelay);
        }
    }
}

// --- UTILITY FUNCTION for sending styled messages ---
// Sends messages with custom JSON formatting like the backup script
async function sendStyledMessage(rconConnection, serverName, message, showHeader = true, targetPlayer = null) {
    const messageColor = STYLING.messageColor;
    const statusText = BOT_NAME;
    
    let jsonPayload;
    
    if (showHeader) {
        // Build JSON payload with [SERVER][BotName] header
        jsonPayload = [
            "",
            {"text":"[","color":STYLING.headerColors.bracket},
            {"text":"SERVER","color":STYLING.headerColors.serverText},
            {"text":"]","color":STYLING.headerColors.bracket},
            {"text":"[","color":STYLING.headerColors.separator},
            {"text":statusText,"color":STYLING.headerColors.botName},
            {"text":"]:","color":STYLING.headerColors.separator},
            {"text":" ","color":STYLING.headerColors.separator},
            {"text":message,"color":messageColor}
        ];
    } else {
        // Just send the message without header (for continuation)
        jsonPayload = [
            "",
            {"text":message,"color":messageColor}
        ];
    }
    
    try {
        const target = targetPlayer ? targetPlayer : "@a";
        await safeRconSend(rconConnection, `tellraw ${target} ${JSON.stringify(jsonPayload)}`, serverName);
    } catch (err) {
        console.error(`[${serverName}] Failed to send styled message via RCON:`, err);
        // Fallback to simple say command
        try {
            const prefix = showHeader ? `[SERVER][${BOT_NAME}] ` : "";
            if (targetPlayer) {
                await safeRconSend(rconConnection, `msg ${targetPlayer} ${prefix}${message}`, serverName);
            } else {
                await safeRconSend(rconConnection, `say ${prefix}${message}`, serverName);
            }
        } catch (fallbackErr) {
            console.error(`[${serverName}] Fallback RCON command also failed:`, fallbackErr);
        }
    }
}

// --- UTILITY FUNCTION for smart word-aware chunking ---
// Splits text into chunks based on available character space, breaking only at word boundaries
function smartChunk(text, firstChunkSize, continuationChunkSize) {
    const words = text.split(' ');
    const chunks = [];
    let currentChunk = '';
    let isFirstChunk = true;
    
    for (const word of words) {
        const maxChunkSize = isFirstChunk ? firstChunkSize : continuationChunkSize;
        
        // Calculate what the length would be if we add this word
        // If currentChunk is empty, no space needed; otherwise add 1 for the space
        const spaceNeeded = currentChunk.length === 0 ? 0 : 1;
        const potentialLength = currentChunk.length + spaceNeeded + word.length;
        
        // If adding this word would exceed the limit AND we already have content
        if (potentialLength > maxChunkSize && currentChunk.length > 0) {
            // Save current chunk and start new one with this word
            chunks.push(currentChunk);
            currentChunk = word;
            isFirstChunk = false;
        } else {
            // Add word to current chunk (with space if needed)
            if (currentChunk.length > 0) {
                currentChunk += ' ';
            }
            currentChunk += word;
        }
    }
    
    // Add the final chunk if there's remaining text
    if (currentChunk.length > 0) {
        chunks.push(currentChunk);
    }
    
    // Debug: log chunk lengths
    console.log('Chunk analysis:');
    chunks.forEach((chunk, i) => {
        const isFirst = i === 0;
        const maxSize = isFirst ? firstChunkSize : continuationChunkSize;
        console.log(`Chunk ${i + 1} (${isFirst ? 'header' : 'continuation'}): ${chunk.length}/${maxSize} chars - "${chunk}"`);
    });
    
    return chunks;
}

// --- UTILITY FUNCTION for sending pre-optimized chunks ---
// Sends chunks that have already been optimized for character limits
async function sendOptimizedChunks(rconConnection, serverName, chunks, isLongResponse = false, targetPlayer = null) {
    const DELAY = isLongResponse ? DELAYS.longResponse : DELAYS.regularResponse;
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirstChunk = i === 0;
        const isLastChunk = i === chunks.length - 1;
          try {
            // Only show header on first chunk
            await sendStyledMessage(rconConnection, serverName, chunk, isFirstChunk, targetPlayer);
            
            // Add delay between chunks (except after the last one)
            if (!isLastChunk) {
                await new Promise(resolve => setTimeout(resolve, DELAY));
            }
        } catch (err) {
            console.error(`[${serverName}] Failed to send message chunk via RCON:`, err);
        }
    }
}

// --- UTILITY FUNCTION for sending custom styled help message ---
// Sends a beautifully formatted help message with colors and styling
async function sendCustomHelpMessage(rconConnection, serverName) {
    const delay = DELAYS.helpMessageDelay;
    const colors = STYLING.helpColors;
    const headerColors = STYLING.headerColors;
    
    // Header line
    const headerPayload = [
        "",
        {"text":"[","color":headerColors.bracket},
        {"text":"SERVER","color":headerColors.serverText},
        {"text":"]","color":headerColors.bracket},
        {"text":"[","color":headerColors.separator},
        {"text":BOT_NAME,"color":headerColors.botName},
        {"text":"]:","color":headerColors.separator},
        {"text":" ","color":headerColors.separator},
        {"text":"* ","color":colors.accent},
        {"text":MESSAGES.helpTitle,"color":colors.title,"bold":true},
        {"text":" *","color":colors.accent}
    ];
    
    // Usage line
    const usagePayload = [
        "",
        {"text":"+ ","color":colors.example},
        {"text":"Usage: ","color":"white","bold":true},
        {"text":BOT_TRIGGER,"color":colors.usage},
        {"text":" [flags] ","color":colors.accent},
        {"text":"<your question>","color":"white"}
    ];
    
    // Flags line 1
    const flags1Payload = [
        "",
        {"text":"- ","color":"red"},
        {"text":"Flags: ","color":"white","bold":true},
        {"text":"-long","color":colors.flags},
        {"text":" (detailed) ","color":"gray"},
        {"text":"-mc","color":colors.usage},
        {"text":" (Minecraft)","color":"gray"}
    ];
    
    // Flags line 2
    const flags2Payload = [
        "",
        {"text":"       ","color":"white"},
        {"text":"-t2","color":"blue"},
        {"text":" (Tekkit2) ","color":"gray"},
        {"text":"-cm","color":"light_purple"},
        {"text":" (Cobblemon) ","color":"gray"},
        {"text":"-me","color":colors.usage},
        {"text":" (private)","color":"gray"}
    ];
    
    // Flags line 3
    const flags3Payload = [
        "",
        {"text":"       ","color":"white"},
        {"text":"-help","color":colors.accent},
        {"text":" (this guide)","color":"gray"}
    ];
    
    // Example line
    const examplePayload = [
        "",
        {"text":"? ","color":colors.accent},
        {"text":"Example: ","color":"white","bold":true},
        {"text":MESSAGES.exampleCommand.replace('{trigger}', BOT_TRIGGER),"color":colors.example,"italic":true}
    ];
    
    // Queue info line
    const queuePayload = [
        "",
        {"text":"@ ","color":colors.note},
        {"text":"Note: ","color":"white","bold":true},
        {"text":"Public responses queue (one at a time). Use ","color":"gray"},
        {"text":"-me","color":colors.usage},
        {"text":" for instant private replies!","color":"gray"}
    ];
    
    // Fun feature line
    const funPayload = [
        "",
        {"text":"!! ","color":colors.tip},
        {"text":"Fun Tip: ","color":"white","bold":true},
        {"text":"Always ask ","color":"gray"},
        {"text":"why","color":colors.accent},
        {"text":"!","color":"gray"}
    ];try {
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(headerPayload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(usagePayload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(flags1Payload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
          await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(flags2Payload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(flags3Payload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(examplePayload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(queuePayload)}`, serverName);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await safeRconSend(rconConnection, `tellraw @a ${JSON.stringify(funPayload)}`, serverName);
    } catch (err) {        console.error(`[${serverName}] Failed to send custom help message via RCON:`, err);
        // Fallback to simple help
        await sendStyledMessage(rconConnection, serverName, MESSAGES.fallbackHelp.replace('{trigger}', BOT_TRIGGER));
    }
}

// --- RCON CONNECTION MANAGEMENT ---
// Creates a robust RCON connection with auto-reconnect and exponential backoff
async function createRconConnection(serverConfig) {
    let rcon = null;
    let reconnectInterval = RECONNECT_CONFIG.initialInterval;
    const maxReconnectInterval = RECONNECT_CONFIG.maxInterval;
    let isConnecting = false;
    
    async function connect() {
        if (isConnecting) return;
        isConnecting = true;
        
        try {
            console.log(`[${serverConfig.name}] Attempting RCON connection...`);
            
            if (rcon) {
                try {
                    await rcon.end();
                } catch (err) {
                    // Ignore errors when closing old connection
                }
            }
            
            rcon = await Rcon.connect({
                host: serverConfig.rconHost,
                port: serverConfig.rconPort,
                password: serverConfig.rconPassword,
            });
            
            console.log(`[${serverConfig.name}] RCON connected successfully!`);
            reconnectInterval = RECONNECT_CONFIG.initialInterval; // Reset retry interval on successful connect
            isConnecting = false;
            
            // Set up error handling
            rcon.on('error', (err) => {
                console.error(`[${serverConfig.name}] RCON Error:`, err.message);
                // Error often precedes close event, so we don't reconnect here
            });
            
            rcon.on('end', () => {
                console.warn(`[${serverConfig.name}] RCON connection closed. Attempting to reconnect in ${reconnectInterval / 1000} seconds...`);
                scheduleReconnect();
            });
            
        } catch (error) {
            console.error(`[${serverConfig.name}] RCON connection failed:`, error.message);
            scheduleReconnect();
        }
    }
    
    function scheduleReconnect() {
        isConnecting = false;
        setTimeout(() => {
            connect();
        }, reconnectInterval);
        
        // Exponential backoff
        if (reconnectInterval < maxReconnectInterval) {
            reconnectInterval *= 2; // Double the wait time for the next attempt
        }
    }
    
    // Initial connection
    await connect();
    
    return {
        getRcon: () => rcon,
        isConnected: () => rcon && !rcon.socket.destroyed,
        reconnect: connect
    };
}

// --- SAFE RCON SEND FUNCTION ---
// Safely sends RCON commands with automatic reconnection on failure
async function safeRconSend(rconConnection, command, serverName) {
    const rcon = rconConnection.getRcon();
    
    if (!rcon || !rconConnection.isConnected()) {
        console.warn(`[${serverName}] RCON not connected, attempting reconnection...`);
        await rconConnection.reconnect();
        const newRcon = rconConnection.getRcon();
        if (!newRcon || !rconConnection.isConnected()) {
            throw new Error('RCON connection failed');
        }
        return await newRcon.send(command);
    }
    
    try {
        return await rcon.send(command);
    } catch (error) {
        console.warn(`[${serverName}] RCON command failed, attempting reconnection...`);
        await rconConnection.reconnect();
        const newRcon = rconConnection.getRcon();
        if (!newRcon || !rconConnection.isConnected()) {
            throw new Error('RCON reconnection failed');
        }
        return await newRcon.send(command);
    }
}

// --- MAIN MULTI-SERVER LOGIC ---
async function main() {
    console.log("Starting multi-server chatbot...");

    // Loop through each server in the config file and set it up
    for (const serverConfig of config.servers) {
        console.log(`[${serverConfig.name}] Initializing...`);        try {
            // Check if the log file exists before proceeding
            if (!fs.existsSync(serverConfig.logPath)) {
                throw new Error(`Log file not found at: ${serverConfig.logPath}`);
            }

            // Store file size to only read new lines
            let lastSize = fs.statSync(serverConfig.logPath).size;            // Create robust RCON connection with auto-reconnect
            const rconConnection = await createRconConnection(serverConfig);

            // Create regex for this server's log format
            const chatRegex = new RegExp(serverConfig.chatRegex || "\\[[^\\]]+\\] \\[Server thread\\/INFO\\](?:\\s\\[[^\\]]+\\])?: <(.+?)> (.*)");

            console.log(`[${serverConfig.name}] Watching log file.`);

            // Create a dedicated watcher for this server's log file
            const watcher = chokidar.watch(serverConfig.logPath, { persistent: true, usePolling: true });

            watcher.on('change', (filePath) => {
                const stats = fs.statSync(filePath);
                const newBytes = stats.size - lastSize;
                if (newBytes <= 0) {
                    // This can happen on log rotation, so we just reset the size
                    if (stats.size < lastSize) {
                        lastSize = stats.size;
                    }
                    return;
                }

                const buffer = Buffer.alloc(newBytes);
                const fd = fs.openSync(filePath, 'r');
                fs.readSync(fd, buffer, 0, newBytes, lastSize);
                fs.closeSync(fd);
                lastSize = stats.size;

                const lines = buffer.toString('utf-8').split('\n').filter(line => line.length > 0);                for (const line of lines) {
                    const match = line.match(chatRegex);if (match) {
                        const playerName = match[1];
                        const message = match[2].trim();

                        // Check for the bot trigger
                        if (message.toLowerCase().startsWith(BOT_TRIGGER)) {
                            const userPrompt = message.substring(BOT_TRIGGER.length).trim();
                            console.log(`[${serverConfig.name}] Received prompt from ${playerName}: "${userPrompt}"`);                            // Use an async IIFE to handle the Gemini call without blocking the file-watching loop
                            (async () => {
                                try {                                    // Check for flags
                                    const isLongRequest = userPrompt.toLowerCase().includes('-long');
                                    const isMcRequest = userPrompt.toLowerCase().includes('-mc');
                                    const isT2Request = userPrompt.toLowerCase().includes('-t2');
                                    const isCmRequest = userPrompt.toLowerCase().includes('-cm');
                                    const isHelpRequest = userPrompt.toLowerCase().includes('-help');
                                    const isMeRequest = userPrompt.toLowerCase().includes('-me');
                                    const hasWhyQuestion = userPrompt.toLowerCase().includes('why');
                                      // Handle help request
                                    if (isHelpRequest) {
                                        // Send custom styled help message with colors
                                        await sendCustomHelpMessage(rconConnection, serverConfig.name);
                                        return;
                                    }
                                      // Remove all flags from the prompt
                                    let actualPrompt = userPrompt
                                        .replace(/-long/gi, '')
                                        .replace(/-mc/gi, '')
                                        .replace(/-t2/gi, '')
                                        .replace(/-cm/gi, '')
                                        .replace(/-me/gi, '')
                                        .trim();
                                    
                                    // Build the prompt with context
                                    let contextPrefix = '';
                                    if (isMcRequest) {
                                        contextPrefix = 'About Java Minecraft in general: ';
                                    } else if (isT2Request) {
                                        contextPrefix = 'About the Tekkit2 modpack for Minecraft: ';
                                    } else if (isCmRequest) {
                                        contextPrefix = 'About the Cobblemon modpack for Minecraft: ';
                                    }
                                    
                                    let prompt = contextPrefix + actualPrompt;
                                    if (!isLongRequest) {
                                        // For regular questions, request a very short response
                                        prompt = `Give a very brief, concise answer (1-2 sentences only) to: ${prompt}`;
                                    } else {
                                        // For -long requests, allow detailed responses
                                        prompt = `Give a detailed explanation (4-8 sentences in one paragraph) for: ${prompt}`;
                                    }                                      const result = await model.generateContent(prompt);
                                    let text = result.response.text().replace(/\n/g, ' ').replace(/"/g, "'");
                                    
                                    // Add "Why not?" prefix for questions containing "why"
                                    if (hasWhyQuestion) {
                                        text = "Why not? " + text;
                                    }                                    // Pre-process the text to create optimized chunks
                                    const optimizedChunks = smartChunk(text, CHUNK_SIZES.headerChunk, CHUNK_SIZES.continuationChunk);
                                      console.log(`[${serverConfig.name}] Gemini Response chunks:`, optimizedChunks);

                                    // Handle response delivery based on -me flag
                                    if (isMeRequest) {
                                        // Private response: send directly to the player, bypassing queue
                                        await sendOptimizedChunks(rconConnection, serverConfig.name, optimizedChunks, isLongRequest, playerName);
                                    } else {
                                        // Public response: add to queue
                                        responseQueue.push({ rconConnection, serverName: serverConfig.name, chunks: optimizedChunks, isLongRequest });
                                        processQueue(); // Start processing if not already busy
                                    }} catch (error) {
                                    console.error(`[${serverConfig.name}] Gemini API Error:`, error);
                                    await sendStyledMessage(rconConnection, serverConfig.name, "I had a problem thinking about that. Please try again.");
                                }
                            })();
                        }
                    }
                }
            });

        } catch (error) {
            console.error(`!!! CRITICAL: Failed to initialize server: ${serverConfig.name} !!!`);
            console.error(`!!! Reason: ${error.message}`);
        }
    }
}

// Start the main application
main().catch(err => console.error("A critical error occurred during startup:", err));
