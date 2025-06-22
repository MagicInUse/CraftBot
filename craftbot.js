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
// Splits text into chunks, accounting for header space on first message
function smartChunk(text, firstChunkSize, continuationChunkSize) {
    const words = text.split(' ');
    const chunks = [];
    let currentChunk = '';
    let isFirstChunk = true;
    
    for (const word of words) {
        const targetChunkSize = isFirstChunk ? firstChunkSize : continuationChunkSize;
        const separator = currentChunk ? ' ' : '';
        
        // Check if adding this word would exceed the chunk size
        if (currentChunk.length + separator.length + word.length > targetChunkSize && currentChunk.length > 0) {
            // Save current chunk and start a new one
            chunks.push(currentChunk.trim());
            currentChunk = word;
            isFirstChunk = false;
        } else {
            // Add word to current chunk
            currentChunk += separator + word;
        }
    }
    
    // Add the final chunk if there's remaining text
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    
    return chunks;
}

// --- UTILITY FUNCTION for sending long messages ---
// Minecraft chat optimized for readability with proper pacing
async function sendLongMessage(rcon, message, isLongResponse = false) {
    // Header line needs space for "[SERVER][Gem]: " which is about 16 characters
    const HEADER_CHUNK_SIZE = 50; // First line with header
    const CONTINUATION_CHUNK_SIZE = 66; // Continuation lines (no header, full width)
    const DELAY = isLongResponse ? 3000 : 1500; // Longer delays for better reading pace
    
    const chunks = smartChunk(message, HEADER_CHUNK_SIZE, CONTINUATION_CHUNK_SIZE);
    
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
                                try {
                                    // Send thinking message
                                    await sendStyledMessage(rcon, "Thinking...", true);
                                    
                                    // Check for -long flag
                                    const isLongRequest = userPrompt.toLowerCase().startsWith('-long ');
                                    let actualPrompt = userPrompt;
                                    
                                    if (isLongRequest) {
                                        // Remove the -long flag from the prompt
                                        actualPrompt = userPrompt.substring(6).trim(); // Remove "-long "
                                    }
                                    
                                    let prompt = actualPrompt;
                                    if (!isLongRequest) {
                                        // For regular questions, request a short response
                                        prompt = `Give a brief, concise answer (1-2 sentences max) to: ${actualPrompt}`;
                                    } else {
                                        // For -long requests, allow detailed responses
                                        prompt = `Give a detailed, comprehensive explanation (2-3 paragraphs) for: ${actualPrompt}`;
                                    }
                                    
                                    const result = await model.generateContent(prompt);
                                    const text = result.response.text().replace(/\n/g, ' ').replace(/"/g, "'");
                                    console.log(`[${serverConfig.name}] Gemini Response: "${text}"`);

                                    // Respond using this specific server's RCON connection
                                    await sendLongMessage(rcon, text, isLongRequest);
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
