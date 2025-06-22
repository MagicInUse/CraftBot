#!/bin/bash
# A script to start the Minecraft bot

# Navigate to the bot's directory
cd ~/CraftBot

# Run the bot using the version of Node installed for this user
# Using /usr/bin/env ensures we find node in the user's PATH
/usr/bin/env node craftbot.js
