# CraftBot - Multi-Server Minecraft Chatbot

A Node.js application for a multi-server Minecraft chatbot that integrates with the Gemini API. This bot monitors multiple Minecraft server log files and responds to chat messages using Google's Gemini AI.

## Features

- **Multi-Server Support**: Monitor and respond to multiple Minecraft servers simultaneously
- **Gemini AI Integration**: Powered by Google's Gemini 1.5 Flash model for intelligent responses
- **RCON Communication**: Uses RCON protocol to send messages back to Minecraft servers
- **Real-time Log Monitoring**: Watches server log files for new chat messages
- **Smart Message Chunking**: Automatically splits long AI responses to fit Minecraft's chat limits
- **Response Queueing**: Prevents chat spam by processing one public response at a time
- **Private Messaging**: `-me` flag for instant private responses that bypass the public queue
- **Context Flags**: Specialized responses for Minecraft, Tekkit2, and Cobblemon modpacks
- **Customizable Response Length**: Concise answers by default, detailed with `-long` flag
- **Beautiful Formatting**: Custom JSON tellraw formatting with `[SERVER][Gem]` branding
- **Systemd Service Support**: Easy deployment as a Linux system service

## Project Structure

```
CraftBot/
├── package.json                    # Project dependencies and metadata
├── .env                           # Environment variables (API keys)
├── config.json                    # Server configurations (working file)
├── config.example.json            # Example server configuration template
├── craftbot.js                    # Main application logic
├── start.sh                       # Linux startup script
├── minecraft-bot.service          # Systemd service file (working file)
├── minecraft-bot.service.example  # Example systemd service template
├── test-config.js                 # Configuration validation script
├── .gitignore                     # Git ignore rules
├── LICENSE                        # License file
└── README.md                      # This file
```

## Prerequisites

- Node.js (v14 or higher)
- Minecraft server(s) with RCON enabled
- Google Gemini API key

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Edit the `.env` file and add your Gemini API key:

```env
GEMINI_API_KEY="your_actual_gemini_api_key_here"
```

Get your API key from [Google AI Studio](https://aistudio.google.com/app/apikey).

### 3. Configure Servers

Copy the example configuration and customize it for your servers:

```bash
cp config.example.json config.json
```

Edit `config.json` to add your Minecraft servers:

```json
{
  "servers": [
    {
      "name": "Survival",
      "logPath": "/path/to/your/survival-server/logs/latest.log",
      "rconHost": "localhost",
      "rconPort": 25575,
      "rconPassword": "your_survival_rcon_password"
    },
    {
      "name": "Creative",
      "logPath": "/path/to/your/creative-server/logs/latest.log",
      "rconHost": "localhost",
      "rconPort": 25585,
      "rconPassword": "your_creative_rcon_password"
    }
  ]
}
```

### 4. Enable RCON on Your Minecraft Servers

Add these lines to your `server.properties` file for each Minecraft server:

```properties
enable-rcon=true
rcon.port=25575
rcon.password=your_rcon_password
```

**Note**: Use different RCON ports for each server if running multiple servers on the same machine.

## Running the Bot

### Development Mode

```bash
npm start
```

or

```bash
node craftbot.js
```

### Linux Systemd Service

1. **Make the startup script executable:**
   ```bash
   chmod +x start.sh
   ```

2. **Copy and customize the service file:**
   ```bash
   sudo cp minecraft-bot.service.example /etc/systemd/system/minecraft-bot.service
   ```

3. **Edit the service file to match your paths and user:**
   ```bash
   sudo nano /etc/systemd/system/minecraft-bot.service
   ```

   Update the following fields:
   - `User=your_user` → `User=minecraft` (or your actual username)
   - `Group=your_user_group` → `Group=minecraft` (or your actual group)
   - `WorkingDirectory=/home/your_user/minecraft-bot` → `WorkingDirectory=/home/minecraft/CraftBot`
   - `ExecStart=/home/your_user/minecraft-bot/start.sh` → `ExecStart=/home/minecraft/CraftBot/start.sh`

4. **Reload systemd and enable the service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable minecraft-bot.service
   ```

5. **Start the service:**
   ```bash
   sudo systemctl start minecraft-bot.service
   ```

6. **Check service status:**
   ```bash
   sudo systemctl status minecraft-bot.service
   ```

7. **View logs:**
   ```bash
   sudo journalctl -u minecraft-bot.service -f
   ```

## Usage

Once the bot is running and monitoring your servers, players can interact with it by typing messages that start with `@gem` in the Minecraft chat.

### Basic Usage

```
@gem What's the weather like today?
@gem How do I make a redstone clock?
@gem Tell me a joke
```

### Advanced Features & Flags

The bot supports several flags to customize responses:

#### Response Length
- **Default**: Concise 1-2 sentence responses
- **`-long`**: Detailed 4-8 sentence explanations

```
@gem -long How does redstone work?
```

#### Context-Specific Help
- **`-mc`**: Java Minecraft general context
- **`-t2`**: Tekkit2 modpack context  
- **`-cm`**: Cobblemon modpack context

```
@gem -mc How do I make a piston?
@gem -t2 What's the best power source?
@gem -cm How do I catch Pokemon?
```

#### Private Responses
- **`-me`**: Send response privately to you (bypasses public queue)

```
@gem -me -long What's the best strategy for this modpack?
```

#### Help
- **`-help`**: Show the in-game help guide

```
@gem -help
```

### Response Queueing System

**Public Responses**: The bot processes one public response at a time to prevent chat spam. If multiple players ask questions simultaneously, they will be queued and answered in order.

**Private Responses**: Using the `-me` flag sends responses directly to you via whisper/private message and bypasses the public queue for instant replies.

### Special Features

- **"Why" Questions**: Questions containing "why" get a fun "Why not?" prefix
- **Smart Chunking**: Long responses are automatically split into readable chunks
- **Beautiful Formatting**: Responses use custom JSON formatting with `[SERVER][Gem]` branding

### How It Works

The bot will:
1. Detect your message in the server logs
2. Process flags and context
3. Query the Gemini API with your question
4. Send the AI response back to Minecraft chat (public or private)
5. Queue additional public responses to prevent spam

## Configuration Options

### Bot Trigger

By default, the bot responds to messages starting with `@gem`. You can change this by modifying the `BOT_TRIGGER` constant in `craftbot.js`:

```javascript
const BOT_TRIGGER = '@assistant'; // Change to your preferred trigger
```

### Message Chunk Size

Long AI responses are automatically split into chunks. You can adjust the chunk size by modifying the `CHUNK_SIZE` constant:

```javascript
const CHUNK_SIZE = 150; // Increase for longer message chunks
```

### Gemini Model

You can change the Gemini model by modifying the model initialization:

```javascript
const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
```

## Troubleshooting

### Common Issues

1. **"Log file not found" error**
   - Verify the log file paths in `config.json`
   - Ensure the Minecraft servers are running and generating logs

2. **RCON connection failures**
   - Check that RCON is enabled in `server.properties`
   - Verify the RCON port and password are correct
   - Ensure the RCON ports are not blocked by firewall

3. **Gemini API errors**
   - Verify your API key is correct in the `.env` file
   - Check your API quota and billing status
   - Ensure you have internet connectivity

4. **Bot not responding to messages**
   - Check the console logs for error messages
   - Verify the bot trigger format (`@gem` by default)
   - Ensure the log file regex pattern matches your server's log format

### Log File Formats

The bot expects Minecraft server logs in this format:
```
[Server thread/INFO]: <PlayerName> message content
```

If your server uses a different format, you may need to adjust the `CHAT_REGEX` pattern in `craftbot.js`.

## Security Considerations

- Keep your `.env` file secure and never commit it to version control
- Use strong RCON passwords
- Consider running the bot on a separate machine or container
- Regularly update dependencies for security patches

## License

ISC

## Author

MagicInUse

## Contributing

Feel free to submit issues and enhancement requests!
A Minecraft + Gemini Chatbot
