import { ChatGroq } from "@langchain/groq";
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { z } from "zod";
import chalk from 'chalk';
import 'dotenv/config';

// Logger similar to your implementation
const logger = {
  step: (message) => console.log(chalk.blue.bold(`\n🔷 ${message}\n`)),
  info: (message) => console.log(chalk.cyan(`ℹ️  ${message}`)),
  success: (message) => console.log(chalk.green(`✅ ${message}`)),
  error: (message) => console.log(chalk.red(`❌ ${message}`)),
  llm: (message) => console.log(chalk.magenta(`🤖 ${message}`)),
  debug: (message) => console.log(chalk.gray(`🔍 ${message}`))
};

const model = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.1-8b-instant",
  temperature: 0,
});

// Schema definitions
function createTranscriptionAnalyzerAgent() {
  const analysisSchema = z.object({
    confidence: z.number().describe("Overall confidence score (0-1)"),
    detectedLanguage: z.string().describe("Detected language code (e.g., 'es', 'en')"),
    speakerCount: z.number().describe("Estimated number of different speakers"),
    contentType: z.enum(['meeting', 'interview', 'lecture', 'phone_call', 'other']).describe("Type of audio content"),
    keyTopics: z.array(z.string()).describe("Main topics or themes discussed"),
    summary: z.string().describe("Brief summary of the content")
  });

  return model.withStructuredOutput(analysisSchema);
}

function createTranscriptionCleanerAgent() {
  const cleaningSchema = z.object({
    cleanedText: z.string().describe("Cleaned and properly formatted transcription in the same language as the original"),
    correctionsCount: z.number().describe("Number of corrections made"),
    mainIssuesFixed: z.array(z.string()).describe("Types of issues that were fixed (e.g., punctuation, grammar, formatting)")
  });

  return model.withStructuredOutput(cleaningSchema);
}

// Audio file utilities
async function validateAudioFile(filePath) {
  try {
    const stats = await fs.stat(filePath);
    const supportedExtensions = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg'];
    const extension = path.extname(filePath).toLowerCase();

    if (!supportedExtensions.includes(extension)) {
      throw new Error(`Unsupported file format: ${extension}`);
    }

    const maxSize = 25 * 1024 * 1024; // 25MB limit for OpenAI Whisper
    if (stats.size > maxSize) {
      logger.info(`File size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);
      throw new Error(`File too large. Maximum size is 25MB`);
    }

    return { valid: true, size: stats.size, extension };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Transcription services
async function transcribeWithGroqWhisper(audioPath, options = {}) {
  const Groq = (await import('groq-sdk')).default;

  const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });

  try {
    logger.step("Starting Groq Whisper transcription...");

    const audioFile = await fs.readFile(audioPath);

    const transcription = await groq.audio.transcriptions.create({
      file: new File([audioFile], path.basename(audioPath)),
      model: "whisper-large-v3", // Groq's Whisper model
      language: options.language !== 'auto' ? options.language : undefined,
      response_format: options.includeTimestamps ? 'verbose_json' : 'text',
      temperature: 0
    });

    return {
      success: true,
      text: typeof transcription === 'string' ? transcription : transcription.text,
      timestamps: transcription.segments || null,
      service: 'groq-whisper'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      service: 'groq-whisper'
    };
  }
}

// Keep OpenAI as fallback option
async function transcribeWithOpenAIWhisper(audioPath, options = {}) {
  const { OpenAI } = await import('openai');

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    logger.step("Starting OpenAI Whisper transcription...");

    const audioFile = await fs.readFile(audioPath);
    const blob = new Blob([audioFile]);
    const file = new File([blob], path.basename(audioPath));

    const transcription = await openai.audio.transcriptions.create({
      file: file,
      model: "whisper-1",
      language: options.language !== 'auto' ? options.language : undefined,
      response_format: options.includeTimestamps ? 'verbose_json' : 'text',
      temperature: 0
    });

    return {
      success: true,
      text: typeof transcription === 'string' ? transcription : transcription.text,
      timestamps: transcription.segments || null,
      service: 'openai-whisper'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      service: 'openai-whisper'
    };
  }
}

async function transcribeWithLocalWhisper(audioPath, options = {}) {
  // This would use a local Whisper implementation
  // You could use: @xenova/transformers, whisper-node, or python subprocess
  logger.info("Local Whisper not implemented yet - falling back to cloud");
  return { success: false, error: "Local whisper not available" };
}

// Main transcription agent
async function transcriptionAgent({
  audioFile,
  outputFormat = 'text', // 'text', 'json', 'srt', 'vtt'
  language = 'auto',
  includeTimestamps = false,
  includeAnalysis = true,
  cleanTranscription = true,
  outputPath = null,
  userPreferences = {}
}) {
  try {
    logger.step("Audio Transcription Agent Starting");

    // Validate audio file
    logger.info("Validating audio file...");
    const validation = await validateAudioFile(audioFile);
    if (!validation.valid) {
      throw new Error(`File validation failed: ${validation.error}`);
    }
    logger.success(`Audio file validated: ${(validation.size / 1024 / 1024).toFixed(2)}MB`);

    // Transcribe audio
    let transcriptionResult;

    // Try local first if available, then cloud services
    logger.step("Attempting transcription...");
    transcriptionResult = await transcribeWithLocalWhisper(audioFile, { language, includeTimestamps });

    if (!transcriptionResult.success) {
      logger.info("Local transcription failed, trying Groq Whisper...");
      transcriptionResult = await transcribeWithGroqWhisper(audioFile, { language, includeTimestamps });
    }

    if (!transcriptionResult.success && process.env.OPENAI_API_KEY) {
      logger.info("Groq transcription failed, trying OpenAI Whisper...");
      transcriptionResult = await transcribeWithOpenAIWhisper(audioFile, { language, includeTimestamps });
    }

    if (!transcriptionResult.success) {
      throw new Error(`Transcription failed: ${transcriptionResult.error}`);
    }

    logger.success(`Transcription completed using ${transcriptionResult.service}`);

    let finalResult = {
      transcription: transcriptionResult.text,
      service: transcriptionResult.service,
      timestamps: transcriptionResult.timestamps
    };

    // Clean transcription with AI
    if (cleanTranscription && transcriptionResult.text) {
      logger.step("Cleaning transcription with AI...");
      const cleaner = createTranscriptionCleanerAgent();

      const cleaningResult = await cleaner.invoke(`
        You need to clean and improve this transcription while keeping it in the SAME LANGUAGE as the original.
        
        Original transcription: "${transcriptionResult.text}"
        
        Only make these minimal improvements:
        1. Fix obvious punctuation errors
        2. Correct capitalization at the beginning of sentences  
        3. Add paragraph breaks where natural pauses occur
        4. Remove excessive filler words only if they interfere with readability
        5. Fix obvious typos or speech recognition errors
        
        IMPORTANT: 
        - Do NOT translate to another language
        - Do NOT over-correct or change the meaning
        - Keep the original tone and style
        - Maintain all technical terms and proper nouns as they are
        
        Return the cleaned text in the same language as the input.
      `);

      if (cleaningResult?.cleanedText) {
        finalResult.cleanedTranscription = cleaningResult.cleanedText;
        finalResult.correctionsCount = cleaningResult.correctionsCount;
        finalResult.issuesFixed = cleaningResult.mainIssuesFixed;
        logger.success(`Applied ${cleaningResult.correctionsCount || 0} corrections`);
      }
    }

    // Analyze content with AI
    if (includeAnalysis && transcriptionResult.text) {
      logger.step("Analyzing transcription content...");
      const analyzer = createTranscriptionAnalyzerAgent();

      const textToAnalyze = finalResult.cleanedTranscription || finalResult.transcription;
      const analysisResult = await analyzer.invoke(`
        Analyze this transcription:
        "${textToAnalyze}"
        
        Provide insights about:
        - Content confidence and quality
        - Detected language
        - Number of speakers
        - Type of content
        - Key topics discussed
        - Brief summary
      `);

      if (analysisResult) {
        finalResult.analysis = analysisResult;
        logger.success("Content analysis completed");
        logger.llm(`Detected: ${analysisResult.contentType} in ${analysisResult.detectedLanguage} with ${analysisResult.speakerCount} speaker(s)`);
      }
    }

    // Save output
    if (outputPath || outputFormat !== 'text') {
      logger.step("Saving output file...");

      // SOLUCIÓN: Usar directorio temporal compatible con Replit
      let outputFile;
      if (outputPath) {
        outputFile = outputPath;
      } else {
        // Crear directorio temporal si no existe
        const tempDir = path.join(process.cwd(), 'temp');
        try {
          await fs.mkdir(tempDir, { recursive: true });
        } catch (err) {
          // Directory might already exist, ignore error
        }

        outputFile = path.join(
          tempDir,
          `transcription_${Date.now()}.${outputFormat === 'json' ? 'json' : 'txt'}`
        );
      }

      let outputContent;
      switch (outputFormat) {
        case 'json':
          outputContent = JSON.stringify(finalResult, null, 2);
          break;
        case 'srt':
          outputContent = convertToSRT(finalResult.timestamps);
          break;
        case 'vtt':
          outputContent = convertToVTT(finalResult.timestamps);
          break;
        default:
          outputContent = finalResult.cleanedTranscription || finalResult.transcription;
      }

      await fs.writeFile(outputFile, outputContent, 'utf-8');
      logger.success(`Output saved to: ${outputFile}`);
      finalResult.outputFile = outputFile;
    }

    return finalResult;

  } catch (error) {
    logger.error(`Transcription failed: ${error.message}`);
    throw error;
  }
}

// Utility functions for subtitle formats
function convertToSRT(segments) {
  if (!segments) return "Timestamps not available";

  return segments.map((segment, index) => {
    const startTime = formatSRTTime(segment.start);
    const endTime = formatSRTTime(segment.end);
    return `${index + 1}\n${startTime} --> ${endTime}\n${segment.text}\n`;
  }).join('\n');
}

function convertToVTT(segments) {
  if (!segments) return "WEBVTT\n\nTimestamps not available";

  let vtt = "WEBVTT\n\n";
  segments.forEach(segment => {
    const startTime = formatVTTTime(segment.start);
    const endTime = formatVTTTime(segment.end);
    vtt += `${startTime} --> ${endTime}\n${segment.text}\n\n`;
  });
  return vtt;
}

function formatSRTTime(seconds) {
  const date = new Date(seconds * 1000);
  const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const secs = String(date.getUTCSeconds()).padStart(2, '0');
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${secs},${ms}`;
}

function formatVTTTime(seconds) {
  return formatSRTTime(seconds).replace(',', '.');
}

export { transcriptionAgent };