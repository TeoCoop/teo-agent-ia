import yargs from "yargs";
import { invoiceAgent } from "./agents/invoiceAgent.js";
import { transcriptionAgent } from "./agents/resumeAudioAgent.js";
const args = yargs(process.argv.slice(2)).argv;


async function getSancorInvoice(dowloadFile) {
  const invoiceInformation = await invoiceAgent({ url: "https://www.sancorsalud.com.ar/login/asociados", dowloadFile});
  return invoiceInformation;
}

async function getTranscribeAudio(params) {
  const p = {
  audioFile: params.audioFile,
  outputFormat: 'text', // 'text', 'json', 'srt', 'vtt'
  language: 'auto',
  includeTimestamps: false,
  includeAnalysis: true,
  cleanTranscription: true,
  outputPath: null,
  userPreferences: {}
  }
  const transcriptionResult = await transcriptionAgent(p);
  return transcriptionResult;
}

async function processAgent(args) {
  console.dir(args, { depth: null });

  switch (args.method) {
    case "getSancorInvoice":
      try {
        const invoiceInfo = await getSancorInvoice({ dowloadFile: args.downloadFile || false });
        console.log("Invoice Information:", invoiceInfo);
      } catch (err) {
        console.log(`processAgent::getSancorInvoice::Error condition found: ${err}`);
        process.exitCode = 1;
      }
      break;
    case "getTranscribeAudio":
      try {
        const transcribeAudio = await getTranscribeAudio({ audioFile: args.audioFile });
        console.log("Transcription Result:", transcribeAudio);
      } catch (err) {
        console.log(`processAgent::getTranscribeAudio::Error condition found: ${err}`);
        process.exitCode = 1;
      }
      break;
    default:
      console.log("No job has been run");
      break;
  }
}

processAgent(args);