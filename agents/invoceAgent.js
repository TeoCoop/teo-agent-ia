import { ChatGroq } from "@langchain/groq";
import { chromium } from 'playwright';
import { getInputIds, insertInputValue, getButtonElements, getAnchorElements, getTable } from '../tools/index.js';
import 'dotenv/config';
import chalk from 'chalk';  // Add this import
import { z } from "zod";

// Add custom logger
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

async function initializeBrowser() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    permissions: [],
    geolocation: { latitude: 0, longitude: 0 },
  });
  global.page = await context.newPage();
  return browser;
}

function createInputAnalyzerAgent() {
  const element = z.object({
    elementId: z.string().describe("The ID of the HTML element"),
  });

  const structuredLlm = model.withStructuredOutput(element);

  return structuredLlm
}

function createButtonAnalyzerAgent() {
  const element = z.object({
    buttonText: z.string().describe("The visible text of the login button (e.g., 'Ingresar', 'Acceder', 'Login')"),
  });

  return model.withStructuredOutput(element);
}

function createTableAnalyzerAgent() {
  const element = z.object({
    expirationDate: z.string().describe("The expiration date"),
    amount: z.string().describe("The amount of the invoice"),
    // facturaId: z.string().describe("The ID of the invoice, get on invoice col provably on element title. e.g., '12345'"),
  });

  return model.withStructuredOutput(element);
}


async function runAgent() {
  const browser = await initializeBrowser();

  try {
    const page = global.page;
    // https://booking.jetsmart.com/V2/Login?culture=es-ar&url=https://jetsmart.com/ar/es/
    // 
    // https://oficinavirtual.camuzzigas.com.ar/landing
    await page.goto('https://www.sancorsalud.com.ar/login/asociados');
    logger.info("Navigating to page...");

    await page.waitForLoadState('domcontentloaded');
    logger.success("Page loaded successfully");

    const inputIds = await getInputIds({ page: page });
    logger.debug(`Found input IDs: ${JSON.stringify(inputIds)}`);

    const analyzerAgent = createInputAnalyzerAgent();

    // INPUT DE USUARIO
    logger.debug(`First step Found user input elements`);

    const userInputResult = await analyzerAgent.invoke(`Given these input IDs: ${JSON.stringify(inputIds)} return the username or email input ID`);

    if (userInputResult && userInputResult.elementId) {
      logger.info(`Username input ID found: ${userInputResult.elementId}`);
      const insertResult = await insertInputValue({
        page,
        inputId: userInputResult.elementId,
        value: process.env.SANCOR_USERNAME
      });

      logger.info(insertResult.message);
    } else {
      throw new Error("No username input ID found in the analysis result.");
    }
    // INPUT DE PASSWORD
    logger.debug(`Second step found password input elements`);

    const passInputResult = await analyzerAgent.invoke(`Given these input IDs: ${JSON.stringify(inputIds)} return the password input ID`);

    if (passInputResult && passInputResult.elementId) {
      logger.info(`pass input ID found: ${passInputResult.elementId}`);
      const insertResult = await insertInputValue({
        page,
        inputId: passInputResult.elementId,
        value: process.env.SANCOR_PASSWORD
      });

      logger.info(insertResult.message);
    } else {
      throw new Error("No password input ID found in the analysis result.");
    }
    // CLICK ON LOGIN
    logger.debug(`Third step found password input elements`);
    const buttonResult = await getButtonElements({ page });
    if (buttonResult.success) {
      console.log(buttonResult);
      const buttonAnalyzer = createButtonAnalyzerAgent();
      console.log(JSON.stringify(buttonResult.buttons));

      const buttonLoginResult = await buttonAnalyzer.invoke(`
      You are given a list of buttons from a login page:
      ${JSON.stringify(buttonResult.buttons)} 

      Your task is to select ONLY the button that most likely corresponds 
      to the login action (e.g., "Ingresar", "Acceder", "Login", "Entrar").
      
      Return its visible text only.
      `);

      if (buttonLoginResult?.buttonText) {
        logger.info(`Login button chosen: ${buttonLoginResult.buttonText}`);
        await page.getByText(buttonLoginResult.buttonText).click();
        logger.success("Clicked login button successfully");
      } else {
        throw new Error("No login button detected by LLM.");
      }
    }
    await page.waitForLoadState('domcontentloaded');
    // CLICK ON Factura
    logger.debug(`Third step found Factura elements`);
    const facturaResult = await getAnchorElements({ page });
    if (facturaResult.success) {
      const facturaAnalyzer = createButtonAnalyzerAgent();

      const buttonFacturaResult = await facturaAnalyzer.invoke(`
      You are given a list of anchor elements from a login page:
      ${JSON.stringify(facturaResult.anchorElements)} 

      Your task is to select ONLY the button that most likely corresponds 
      to the invoice action (e.g., "Invoice", "Facturas").

      Return its visible text only.
      `);

      if (buttonFacturaResult?.buttonText) {
        logger.info(`Factura button chosen: ${buttonFacturaResult.buttonText}`);
        await page.getByText(buttonFacturaResult.buttonText).click();
        logger.success("Clicked factura button successfully");
      } else {
        throw new Error("No factura button detected by LLM.");
      }
    }
    // GET factura TABLE
    logger.debug(`Get the invoice information`);
    await page.waitForTimeout(10000);
    const facturaTable = await getTable({ page });
    if (facturaTable.success) {
      const tablenalyzer = createTableAnalyzerAgent();
      const invoiceResult = await tablenalyzer.invoke(`
        You are given the following table elements:
        ${JSON.stringify(facturaTable.tableElements)}

        Return **only a JSON object** with the following fields:
        {
          "expirationDate": "...",
          "amount": "..."
        }
        The JSON must be parseable and match the schema exactly.
        `);

      if (invoiceResult) {
        logger.info(`Invoice found: ${JSON.stringify(invoiceResult, null, 2)}`);
        logger.success("Invoice found successfully");
      } else {
        throw new Error("No factura button detected by LLM.");
      }

    }

    await page.waitForTimeout(50000);

  } catch (error) {
    logger.error(`Error: ${error.message}`);
  } finally {
    await browser.close();
  }
}

export {
  runAgent
};

