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
const BOT_TRIGGER = '@gem';

// --- INITIALIZE GEMINI ---
if (!GEMINI_API_KEY || GEMINI_API_KEY === "PASTE_YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("GEMINI_API_KEY is not defined. Please check your .env file.");
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Regular expression to capture chat messages from the log
// Updated to handle both vanilla and modded server log formats
const CHAT_REGEX = /\[[^\]]+\] \[Server thread\/INFO\](?:\s\[[^\]]+\])?: <(.+?)> (.*)/;

// --- UTILITY FUNCTION for sending styled messages ---
// Sends messages with custom JSON formatting like the backup script
async function sendStyledMessage(rcon, message, isThinking = false, showHeader = true) {
    const messageColor = isThinking ? "gray" : "white";
    const statusText = isThinking ? "Thinking" : "Gem";
    
    let jsonPayload;
    
    if (showHeader) {
        // Build JSON payload with [SERVER][Gem] header
        jsonPayload = [
            "",
            {"text":"[","color":"gold"},
            {"text":"SERVER","color":"gray"},
            {"text":"]","color":"gold"},
            {"text":"[","color":"gray"},
            {"text":statusText,"color":"aqua"},
            {"text":"]:","color":"gray"},
            {"text":" ","color":"gray"},
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
        await rcon.send(`tellraw @a ${JSON.stringify(jsonPayload)}`);
    } catch (err) {
        console.error("Failed to send styled message via RCON:", err);
        // Fallback to simple say command
        const prefix = showHeader ? "[SERVER][Gem] " : "";
        await rcon.send(`say ${prefix}${message}`);
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
async function sendOptimizedChunks(rcon, chunks, isLongResponse = false) {
    const DELAY = isLongResponse ? 3000 : 1500; // Longer delays for better reading pace
    
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const isFirstChunk = i === 0;
        const isLastChunk = i === chunks.length - 1;
        
        try {
            // Only show header on first chunk
            await sendStyledMessage(rcon, chunk, false, isFirstChunk);
            
            // Add delay between chunks (except after the last one)
            if (!isLastChunk) {
                await new Promise(resolve => setTimeout(resolve, DELAY));
            }
        } catch (err) {
            console.error("Failed to send message chunk via RCON:", err);
        }
    }
}

// --- UTILITY FUNCTION for sending custom styled help message ---
// Sends a beautifully formatted help message with colors and styling
async function sendCustomHelpMessage(rcon) {
    const delay = 1000; // 1 second delay between help lines
      // Header line
    const headerPayload = [
        "",
        {"text":"[","color":"gold"},
        {"text":"SERVER","color":"gray"},
        {"text":"]","color":"gold"},
        {"text":"[","color":"gray"},
        {"text":"Gem","color":"aqua"},
        {"text":"]:","color":"gray"},
        {"text":" ","color":"gray"},
        {"text":"* ","color":"yellow"},
        {"text":"CraftBot Help Guide","color":"light_purple","bold":true},
        {"text":" *","color":"yellow"}
    ];
      // Usage line
    const usagePayload = [
        "",
        {"text":"+ ","color":"aqua"},
        {"text":"Usage: ","color":"white","bold":true},
        {"text":"@gem","color":"green"},
        {"text":" [flags] ","color":"yellow"},
        {"text":"<your question>","color":"white"}
    ];
    
    // Flags line 1
    const flags1Payload = [
        "",
        {"text":"- ","color":"red"},
        {"text":"Flags: ","color":"white","bold":true},
        {"text":"-long","color":"gold"},
        {"text":" (detailed) ","color":"gray"},
        {"text":"-mc","color":"green"},
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
        {"text":"-help","color":"yellow"},
        {"text":" (this guide)","color":"gray"}
    ];
    
    // Example line
    const examplePayload = [
        "",
        {"text":"? ","color":"yellow"},
        {"text":"Example: ","color":"white","bold":true},
        {"text":"'@gem -mc -long what is redstone?'","color":"aqua","italic":true}
    ];
    
    // Fun feature line
    const funPayload = [
        "",
        {"text":"! ","color":"gold"},
        {"text":"Fun Tip: ","color":"white","bold":true},
        {"text":"Ask ","color":"gray"},
        {"text":"'why'","color":"yellow"},
        {"text":" questions for a surprise!","color":"gray"}
    ];
      try {
        await rcon.send(`tellraw @a ${JSON.stringify(headerPayload)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await rcon.send(`tellraw @a ${JSON.stringify(usagePayload)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await rcon.send(`tellraw @a ${JSON.stringify(flags1Payload)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await rcon.send(`tellraw @a ${JSON.stringify(flags2Payload)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await rcon.send(`tellraw @a ${JSON.stringify(examplePayload)}`);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        await rcon.send(`tellraw @a ${JSON.stringify(funPayload)}`);
    } catch (err) {
        console.error("Failed to send custom help message via RCON:", err);
        // Fallback to simple help
        await sendStyledMessage(rcon, "CraftBot Help: Use @gem with your questions. Try -help for more info!");
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
            let lastSize = fs.statSync(serverConfig.logPath).size;            // Connect to this server's RCON
            const rcon = await Rcon.connect({
                host: serverConfig.rconHost,
                port: serverConfig.rconPort,
                password: serverConfig.rconPassword,
            });

            console.log(`[${serverConfig.name}] RCON connected. Watching log file.`);
            rcon.on('error', (err) => console.error(`[${serverConfig.name}] RCON Error:`, err));

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

                const lines = buffer.toString('utf-8').split('\n').filter(line => line.length > 0);

                for (const line of lines) {
                    const match = line.match(CHAT_REGEX);                    if (match) {
                        const playerName = match[1];
                        const message = match[2].trim();

                        // Check for the bot trigger
                        if (message.toLowerCase().startsWith(BOT_TRIGGER)) {
                            const userPrompt = message.substring(BOT_TRIGGER.length).trim();
                            console.log(`[${serverConfig.name}] Received prompt from ${playerName}: "${userPrompt}"`);                            // Use an async IIFE to handle the Gemini call without blocking the file-watching loop
                            (async () => {
                                try {                                    // Send thinking message
                                    await sendStyledMessage(rcon, "Thinking...", true);// Check for flags
                                    const isLongRequest = userPrompt.toLowerCase().includes('-long');
                                    const isMcRequest = userPrompt.toLowerCase().includes('-mc');
                                    const isT2Request = userPrompt.toLowerCase().includes('-t2');
                                    const isCmRequest = userPrompt.toLowerCase().includes('-cm');
                                    const isHelpRequest = userPrompt.toLowerCase().includes('-help');
                                    const hasWhyQuestion = userPrompt.toLowerCase().includes('why');
                                      // Handle help request
                                    if (isHelpRequest) {
                                        // Send custom styled help message with colors
                                        await sendCustomHelpMessage(rcon);
                                        return;
                                    }
                                    
                                    // Remove all flags from the prompt
                                    let actualPrompt = userPrompt
                                        .replace(/-long/gi, '')
                                        .replace(/-mc/gi, '')
                                        .replace(/-t2/gi, '')
                                        .replace(/-cm/gi, '')
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
                                    }
                                      // Pre-process the text to create optimized chunks
                                    const HEADER_CHUNK_SIZE = 45;  // Reduced to be more conservative
                                    const CONTINUATION_CHUNK_SIZE = 60;  // Reduced to account for font width variations
                                    const optimizedChunks = smartChunk(text, HEADER_CHUNK_SIZE, CONTINUATION_CHUNK_SIZE);
                                    
                                    console.log(`[${serverConfig.name}] Gemini Response chunks:`, optimizedChunks);

                                    // Send the optimized chunks
                                    await sendOptimizedChunks(rcon, optimizedChunks, isLongRequest);
                                } catch (error) {
                                    console.error(`[${serverConfig.name}] Gemini API Error:`, error);
                                    await sendStyledMessage(rcon, "I had a problem thinking about that. Please try again.");
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
