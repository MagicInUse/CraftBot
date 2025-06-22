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

// --- UTILITY FUNCTION for sending long messages ---
// Minecraft chat has a character limit, so this splits long responses.
async function sendLongMessage(rcon, message) {
    const CHUNK_SIZE = 100;
    const prefix = "[Bot] ";
    const chunks = message.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) || [];
    for (const chunk of chunks) {
        try {
            await rcon.send(`say ${prefix}${chunk}`);
            // Add a small delay to prevent spamming the chat and to ensure message order
            await new Promise(resolve => setTimeout(resolve, 300));
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
            let lastSize = fs.statSync(serverConfig.logPath).size;

            // Connect to this server's RCON
            const rcon = await Rcon.connect({
                host: serverConfig.rconHost,
                port: serverConfig.rconPort,
                password: serverConfig.rconPassword,
            });            console.log(`[${serverConfig.name}] RCON connected. Watching log file.`);
            rcon.on('error', (err) => console.error(`[${serverConfig.name}] RCON Error:`, err));            // Create a dedicated watcher for this server's log file
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
                    const match = line.match(CHAT_REGEX);
                    if (match) {
                        const playerName = match[1];
                        const message = match[2].trim();

                        // Check for the bot trigger
                        if (message.toLowerCase().startsWith(BOT_TRIGGER)) {
                            const userPrompt = message.substring(BOT_TRIGGER.length).trim();
                            console.log(`[${serverConfig.name}] Received prompt from ${playerName}: "${userPrompt}"`);

                            rcon.send(`tellraw ${playerName} {"text":"[Bot] Thinking...", "color":"gray", "italic":true}`);

                            // Use an async IIFE to handle the Gemini call without blocking the file-watching loop
                            (async () => {
                                try {
                                    const result = await model.generateContent(userPrompt);
                                    const text = result.response.text().replace(/\n/g, ' ').replace(/"/g, "'");
                                    console.log(`[${serverConfig.name}] Gemini Response: "${text}"`);

                                    // Respond using this specific server's RCON connection
                                    await sendLongMessage(rcon, text);
                                } catch (error) {
                                    console.error(`[${serverConfig.name}] Gemini API Error:`, error);
                                    rcon.send(`say [Bot] I had a problem thinking about that. Please try again.`);
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
