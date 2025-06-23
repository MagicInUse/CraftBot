// Test script to verify CraftBot configuration
require('dotenv').config();

const fs = require('fs');
const { GoogleGenerativeAI } = require('@google/generative-ai');

console.log('CraftBot Configuration Test');
console.log('===========================\n');

// Test 1: Check .env file
console.log('1. Testing environment variables...');
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey || apiKey === "I will do this later - redacted for now") {
    console.log('   ❌ GEMINI_API_KEY not set or still using placeholder');
    console.log('   → Please update your .env file with a valid API key');
} else {
    console.log('   ✅ GEMINI_API_KEY is configured');
}

// Test 2: Check config.json
console.log('\n2. Testing server configuration...');
try {
    const config = JSON.parse(fs.readFileSync('./config.json', 'utf-8'));
    console.log(`   ✅ Found ${config.servers.length} server(s) in config`);
      config.servers.forEach((server, index) => {
        console.log(`   Server ${index + 1}: ${server.name}`);
        
        // Check log path
        if (fs.existsSync(server.logPath)) {
            console.log(`     ✅ Log file exists: ${server.logPath}`);
        } else {
            console.log(`     ❌ Log file not found: ${server.logPath}`);
            console.log(`     → Please update the logPath in config.json`);
        }
        
        // Check chat regex pattern
        try {
            const regex = new RegExp(server.chatRegex || "\\[[^\\]]+\\] \\[Server thread\\/INFO\\](?:\\s\\[[^\\]]+\\])?: <(.+?)> (.*)");
            console.log(`     ✅ Chat regex pattern is valid`);
            
            // Test regex with sample log lines
            const sampleVanilla = "[12:34:56] [Server thread/INFO]: <TestPlayer> hello world";
            const sampleModded = "[12:34:56] [Server thread/INFO] [SomeModName]: <TestPlayer> hello world";
            
            if (regex.test(sampleVanilla) || regex.test(sampleModded)) {
                console.log(`     ✅ Regex pattern matches expected log formats`);
            } else {
                console.log(`     ⚠️  Regex pattern may not match standard log formats`);
            }
        } catch (regexError) {
            console.log(`     ❌ Invalid chat regex pattern: ${regexError.message}`);
        }
        
        // Check if using default values
        if (server.logPath.includes('/full/path/to/your')) {
            console.log(`     ❌ Using placeholder path`);
        }
        if (server.rconPassword === 'your_survival_rcon_password' || 
            server.rconPassword === 'your_creative_rcon_password') {
            console.log(`     ❌ Using placeholder RCON password`);
        }
    });
} catch (error) {
    console.log('   ❌ Error reading config.json:', error.message);
}

// Test 3: Test Gemini API (if API key is set)
console.log('\n3. Testing Gemini API connection...');
if (apiKey && apiKey !== "I will do this later - redacted for now") {
    (async () => {
        try {
            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const result = await model.generateContent("Say 'Hello from CraftBot test!'");
            const response = result.response.text();
            console.log('   ✅ Gemini API connection successful');
            console.log(`   Response: ${response.substring(0, 50)}...`);
        } catch (error) {
            console.log('   ❌ Gemini API connection failed:', error.message);
            if (error.message.includes('API key')) {
                console.log('   → Check your API key is valid and has proper permissions');
            }
        }
    })();
} else {
    console.log('   ⏭️  Skipped (API key not configured)');
}

// Test 4: Check dependencies
console.log('\n4. Testing dependencies...');
try {
    require('@google/generative-ai');
    require('chokidar');
    require('dotenv');
    require('rcon-client');
    console.log('   ✅ All dependencies are installed');
} catch (error) {
    console.log('   ❌ Missing dependencies:', error.message);
    console.log('   → Run "npm install" to install missing packages');
}

console.log('\n===========================');
console.log('Configuration test complete!');
console.log('\nIf you see any ❌ errors above, please fix them before running CraftBot.');
console.log('Once everything shows ✅, you can start the bot with "npm start"');
