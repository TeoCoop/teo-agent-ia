import express from "express";
import TelegramBot from "node-telegram-bot-api";
import bodyParser from "body-parser";
import 'dotenv/config';
import { invoiceAgent } from "../agents/invoiceAgent.js";
import path from "path";
import os from "os";
import fs from "fs";
import https from "https";
import { promisify } from "util";
import { transcriptionAgent } from "../agents/resumeAudioAgent.js";

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = process.env.WEBHOOK_URL || `http://localhost:${PORT}`;

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Initialize Telegram bot
const bot = new TelegramBot(BOT_TOKEN);

// Use polling for development
const botPolling = new TelegramBot(BOT_TOKEN, { polling: true });

// Store user sessions waiting for audio
const audioSessions = new Map();

// Utility function to download file from Telegram
async function downloadTelegramFile(fileId, fileName) {
  try {
    const file = await botPolling.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    
    // Create downloads directory if it doesn't exist
    const downloadsDir = path.join(os.homedir(), "Downloads", "telegram_audio");
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
    
    const filePath = path.join(downloadsDir, fileName);
    const writeStream = fs.createWriteStream(filePath);
    
    return new Promise((resolve, reject) => {
      https.get(fileUrl, (response) => {
        response.pipe(writeStream);
        writeStream.on('finish', () => {
          writeStream.close();
          resolve(filePath);
        });
        writeStream.on('error', reject);
      }).on('error', reject);
    });
  } catch (error) {
    throw new Error(`Failed to download file: ${error.message}`);
  }
}

// Task handlers
const taskHandlers = {
  getInvoice: async (params, chatId) => {
    const { username, password } = params;

    if (!username || !password) {
      return 'Error: Missing required parameters. Please provide user and password.';
    }

    const user = { username, password };
    
    try {
      console.log(`Getting invoice for user: ${username}`);
      const invoiceInformation = await invoiceAgent({ 
        url: "https://www.sancorsalud.com.ar/login/asociados", 
        dowloadFile: true, 
        ussingTelegram: true, 
        userInformation: user 
      });

      console.log(invoiceInformation);

      if (invoiceInformation.facturaId) {
        const desktopPath = path.join(os.homedir(), "Desktop", `${invoiceInformation.facturaId}.pdf`);

        if (fs.existsSync(desktopPath)) {
          try {
            await botPolling.sendDocument(chatId, desktopPath, {
              caption: `📄 Invoice PDF: ${invoiceInformation.facturaId}`
            });

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
        return `📄 Invoice Retrieved:\n${JSON.stringify(invoiceInformation, null, 2)}`;
      }

    } catch (error) {
      console.error('Error getting invoice:', error);
      return 'Error: Failed to retrieve invoice. Please try again later.';
    }
  },

  getUserInfo: async (params, chatId) => {
    // Start audio session
    audioSessions.set(chatId, {
      waitingForAudio: true,
      startTime: Date.now(),
      params: params
    });

    return '🎤 Please share me an audio message and I will transcribe it for you.\n\n' +
           '📝 I can:\n' +
           '• Transcribe audio to text\n' +
           '• Provide a summary\n' +
           '• Detect language automatically\n' +
           '• Handle multiple languages\n\n' +
           '⏰ Session will expire in 5 minutes if no audio is received.';
  }
};

// Handle audio processing
async function processAudio(msg, chatId) {
  const session = audioSessions.get(chatId);
  if (!session || !session.waitingForAudio) {
    return null; // No active session
  }

  // Clear the session
  audioSessions.delete(chatId);

  try {
    // Send processing message
    const processingMsg = await botPolling.sendMessage(chatId, '🔄 Processing your audio... Please wait.');

    let fileId, fileName, mimeType;

    // Handle different audio types
    if (msg.voice) {
      fileId = msg.voice.file_id;
      fileName = `voice_${Date.now()}.ogg`;
      mimeType = 'audio/ogg';
    } else if (msg.audio) {
      fileId = msg.audio.file_id;
      fileName = msg.audio.file_name || `audio_${Date.now()}.mp3`;
      mimeType = msg.audio.mime_type || 'audio/mpeg';
    } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('audio/')) {
      fileId = msg.document.file_id;
      fileName = msg.document.file_name || `document_${Date.now()}.mp3`;
      mimeType = msg.document.mime_type;
    } else {
      await botPolling.editMessageText(
        '❌ Please send an audio message, voice note, or audio file.',
        { chat_id: chatId, message_id: processingMsg.message_id }
      );
      return;
    }

    console.log(`Processing ${mimeType} file: ${fileName}`);

    // Download the audio file
    const audioFilePath = await downloadTelegramFile(fileId, fileName);
    console.log(`Audio downloaded to: ${audioFilePath}`);

    // Process with transcription agent
    const transcriptionResult = await transcriptionAgent({
      audioFile: audioFilePath,
      outputFormat: 'json',
      includeTimestamps: false,
      includeAnalysis: true,
      cleanTranscription: false, // Disable to avoid the error you had
      language: 'auto'
    });

    // Clean up the downloaded file
    if (fs.existsSync(audioFilePath)) {
      fs.unlinkSync(audioFilePath);
      console.log(`Cleaned up: ${audioFilePath}`);
    }

    // Format response
    let response = '🎵 Audio Transcription Complete!\n\n';
    
    if (transcriptionResult.analysis) {
      response += `📊 Analysis:\n`;
      response += `• Language: ${transcriptionResult.analysis.detectedLanguage}\n`;
      response += `• Content Type: ${transcriptionResult.analysis.contentType}\n`;
      response += `• Speakers: ${transcriptionResult.analysis.speakerCount}\n`;
      response += `• Service: ${transcriptionResult.service}\n\n`;
    }

    response += `📝 Transcription:\n${transcriptionResult.transcription}\n\n`;

    if (transcriptionResult.analysis && transcriptionResult.analysis.summary) {
      response += `📋 Summary:\n${transcriptionResult.analysis.summary}\n\n`;
    }

    if (transcriptionResult.analysis && transcriptionResult.analysis.keyTopics && transcriptionResult.analysis.keyTopics.length > 0) {
      response += `🔑 Key Topics:\n${transcriptionResult.analysis.keyTopics.map(topic => `• ${topic}`).join('\n')}`;
    }

    // Update the processing message with results
    await botPolling.editMessageText(response, {
      chat_id: chatId,
      message_id: processingMsg.message_id
    });

  } catch (error) {
    console.error('Error processing audio:', error);
    audioSessions.delete(chatId); // Clear session on error
    
    await botPolling.sendMessage(chatId, 
      `❌ Error processing audio: ${error.message}\n\n` +
      'Please try again with a different audio file or format.'
    );
  }
}

// Parse command and parameters from message
function parseCommand(text) {
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

  console.log(`Received message from chat ${chatId}:`, {
    text: text,
    hasVoice: !!msg.voice,
    hasAudio: !!msg.audio,
    hasDocument: !!msg.document
  });

  // Check if user has an active audio session
  const session = audioSessions.get(chatId);
  if (session && session.waitingForAudio) {
    // Check session timeout (5 minutes)
    if (Date.now() - session.startTime > 5 * 60 * 1000) {
      audioSessions.delete(chatId);
      await botPolling.sendMessage(chatId, '⏰ Audio session expired. Please use /getUserInfo again if you want to transcribe audio.');
      return;
    }

    // Handle audio messages
    if (msg.voice || msg.audio || (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('audio/'))) {
      await processAudio(msg, chatId);
      return;
    }

    // Handle text message during audio session (cancel session)
    if (text) {
      audioSessions.delete(chatId);
      await botPolling.sendMessage(chatId, '❌ Audio session cancelled. You sent text instead of audio.');
      return;
    }

    // Handle other message types during audio session
    audioSessions.delete(chatId);
    await botPolling.sendMessage(chatId, '❌ Audio session cancelled. Please send an audio message next time.');
    return;
  }

  // Handle regular commands (no active audio session)
  if (!text || !text.startsWith('/')) {
    await botPolling.sendMessage(chatId,
      '🤖 Welcome! Send me a command in this format:\n' +
      '/taskName param1:value1 param2:value2\n\n' +
      'Available tasks:\n' +
      '• /getInvoice username:username password:userpass\n' +
      '• /getUserInfo - Start audio transcription session\n\n' +
      '🎤 For audio transcription, use /getUserInfo and then send me an audio message!'
    );
    return;
  }

  const { command, params } = parseCommand(text);

  if (taskHandlers[command]) {
    try {
      const response = await taskHandlers[command](params, chatId);
      await botPolling.sendMessage(chatId, response);
    } catch (error) {
      console.error('Error executing task:', error);
      await botPolling.sendMessage(chatId, 'Error: Something went wrong while processing your request.');
    }
  } else {
    await botPolling.sendMessage(chatId,
      `❌ Unknown task: ${command}\n\n` +
      'Available tasks:\n' +
      '• /getInvoice username:username password:userpass\n' +
      '• /getUserInfo - Start audio transcription session'
    );
  }
});

// Clean up expired sessions every minute
setInterval(() => {
  const now = Date.now();
  const expiredSessions = [];
  
  audioSessions.forEach((session, chatId) => {
    if (now - session.startTime > 5 * 60 * 1000) { // 5 minutes
      expiredSessions.push(chatId);
    }
  });
  
  expiredSessions.forEach(chatId => {
    audioSessions.delete(chatId);
    console.log(`Cleaned up expired audio session for chat ${chatId}`);
  });
}, 60000); // Run every minute

// Webhook endpoint (for production)
app.post(`/bot${BOT_TOKEN}`, async (req, res) => {
  const { message } = req.body;

  if (message) {
    const chatId = message.chat.id;
    const text = message.text;

    console.log(`Webhook received from chat ${chatId}:`, {
      text: text,
      hasVoice: !!message.voice,
      hasAudio: !!message.audio,
      hasDocument: !!message.document
    });

    // Check if user has an active audio session
    const session = audioSessions.get(chatId);
    if (session && session.waitingForAudio) {
      // Check session timeout
      if (Date.now() - session.startTime > 5 * 60 * 1000) {
        audioSessions.delete(chatId);
        await bot.sendMessage(chatId, '⏰ Audio session expired. Please use /getUserInfo again if you want to transcribe audio.');
        return res.sendStatus(200);
      }

      // Handle audio messages
      if (message.voice || message.audio || (message.document && message.document.mime_type && message.document.mime_type.startsWith('audio/'))) {
        await processAudio(message, chatId);
        return res.sendStatus(200);
      }

      // Handle text message during audio session
      if (text) {
        audioSessions.delete(chatId);
        await bot.sendMessage(chatId, '❌ Audio session cancelled. You sent text instead of audio.');
        return res.sendStatus(200);
      }

      // Handle other message types
      audioSessions.delete(chatId);
      await bot.sendMessage(chatId, '❌ Audio session cancelled. Please send an audio message next time.');
      return res.sendStatus(200);
    }

    // Handle regular commands
    if (!text || !text.startsWith('/')) {
      await bot.sendMessage(chatId,
        '🤖 Welcome! Send me a command in this format:\n' +
        '/taskName param1:value1 param2:value2\n\n' +
        'Available tasks:\n' +
        '• /getInvoice username:username password:userpass\n' +
        '• /getUserInfo - Start audio transcription session'
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
        '• /getUserInfo - Start audio transcription session'
      );
    }
  }

  res.sendStatus(200);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    activeSessions: audioSessions.size 
  });
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