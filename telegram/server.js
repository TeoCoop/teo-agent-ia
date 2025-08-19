import express from "express";
import TelegramBot from "node-telegram-bot-api";
import bodyParser from "body-parser";
import 'dotenv/config';
import { invoiceAgent } from "../agents/invoiceAgent.js";
import path from "path";
import os from "os";
import fs from "fs";
// Configuration
const BOT_TOKEN = process.env.TELEGRAM_TOKEN; // Get from @BotFather on Telegram
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || `http://localhost:${PORT}`;

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Initialize Telegram bot
const bot = new TelegramBot(BOT_TOKEN);

// Set webhook (comment out if using polling)
// bot.setWebHook(`${WEBHOOK_URL}/bot${BOT_TOKEN}`);

// Use polling for development (comment out if using webhook)
const botPolling = new TelegramBot(BOT_TOKEN, { polling: true });

// Task handlers
const taskHandlers = {
  getInvoice: async (params, chatId) => {
    const { username, password } = params;

    // Validate required parameters
    if (!username || !password) {
      return 'Error: Missing required parameters. Please provide user and password.';
    }

    const user = {
      username,
      password
    }
    try {
      // Simulate invoice retrieval logic
      console.log(`Getting invoice for user: ${username}`);

      const invoiceInformation = await invoiceAgent({ url: "https://www.sancorsalud.com.ar/login/asociados", dowloadFile: true, ussingTelegram: true, userInformation: user });

      // Here you would implement your actual invoice logic
      // For example: database query, API call, etc.
 console.log(invoiceInformation);
      // If download was requested and successful
      if (invoiceInformation.facturaId) {
       
        
        const desktopPath = path.join(os.homedir(), "Desktop", `${invoiceInformation.facturaId}.pdf`);

        // Check if file exists
        if (fs.existsSync(desktopPath)) {
          try {
            // Send the PDF file
            await botPolling.sendDocument(chatId, desktopPath, {
              caption: `📄 Invoice PDF: ${invoiceInformation.facturaId}`
            });

            // Optionally delete the file after sending
            fs.unlinkSync(desktopPath);
            console.log(`File sent and deleted: ${desktopPath}`);

            return `✅ Invoice PDF sent successfully!\nInvoice ID: ${invoiceInformation.facturaId}`;
          } catch (fileError) {
            console.error('Error sending file:', fileError);
            return `📄 Invoice Retrieved (file send failed):\n${JSON.stringify(invoiceInformation, null, 2)}`;
          }
        } else {
          return `📄 Invoice Retrieved (file not found):\n${JSON.stringify(invoiceInformation, null, 2)}`;
        }
      } else {
        // Just return the invoice information
        return `📄 Invoice Retrieved:\n${JSON.stringify(invoiceInformation, null, 2)}`;
      }

    } catch (error) {
      console.error('Error getting invoice:', error);
      return 'Error: Failed to retrieve invoice. Please try again later.';
    }
  },

};

// Parse command and parameters from message
function parseCommand(text) {
  // Expected format: /task_name param1:value1 param2:value2
  const parts = text.trim().split(' ');
  const command = parts[0].replace('/', '');
  const params = {};

  for (let i = 1; i < parts.length; i++) {
    const param = parts[i];
    if (param.includes(':')) {
      const [key, ...valueParts] = param.split(':');
      params[key] = valueParts.join(':');
    }
  }

  return { command, params };
}

// Handle incoming messages (for polling)
botPolling.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  console.log(`Received message: ${text} from chat: ${chatId}`);

  if (!text.startsWith('/')) {
    botPolling.sendMessage(chatId,
      '🤖 Welcome! Send me a command in this format:\n' +
      '/taskName param1:value1 param2:value2\n\n' +
      'Available tasks:\n' +
      '• /getInvoice user:username password:userpass\n' +
      '• /getUserInfo userId:123\n\n' +
      'Example: /getInvoice user:john password:secret123'
    );
    return;
  }

  const { command, params } = parseCommand(text);

  if (taskHandlers[command]) {
    try {
      const response = await taskHandlers[command](params, chatId);
      botPolling.sendMessage(chatId, response);
    } catch (error) {
      console.error('Error executing task:', error);
      botPolling.sendMessage(chatId, 'Error: Something went wrong while processing your request.');
    }
  } else {
    botPolling.sendMessage(chatId,
      `❌ Unknown task: ${command}\n\n` +
      'Available tasks:\n' +
      '• /getInvoice user:username password:userpass\n' +
      '• /getUserInfo userId:123'
    );
  }
});

// Webhook endpoint (for production)
app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
  const { message } = req.body;

  if (message && message.text) {
    const chatId = message.chat.id;
    const text = message.text;

    console.log(`Webhook received: ${text} from chat: ${chatId}`);

    if (!text.startsWith('/')) {
      await bot.sendMessage(chatId,
        '🤖 Welcome! Send me a command in this format:\n' +
        '/taskName param1:value1 param2:value2\n\n' +
        'Available tasks:\n' +
        '• /getInvoice user:username password:userpass\n' +
        '• /getUserInfo userId:123'
      );
      return res.sendStatus(200);
    }

    const { command, params } = parseCommand(text);

    if (taskHandlers[command]) {
      try {
        const response = await taskHandlers[command](params, chatId);
        await bot.sendMessage(chatId, response);
      } catch (error) {
        console.error('Error executing task:', error);
        await bot.sendMessage(chatId, 'Error: Something went wrong while processing your request.');
      }
    } else {
      await bot.sendMessage(chatId,
        `❌ Unknown task: ${command}\n\n` +
        'Available tasks:\n' +
        '• /getInvoice username:username password:userpass\n' +
        '• /getUserInfo userId:123'
      );
    }
  }

  res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Telegram bot server running on port ${PORT}`);
  console.log(`📱 Bot is ready to receive messages`);
  console.log(`🔗 Webhook URL: ${WEBHOOK_URL}/bot${BOT_TOKEN}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('🛑 Shutting down bot server...');
  botPolling.stopPolling();
  process.exit(0);
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});