import { invoiceAgent } from "./agents/invoceAgent.js";
import yargs from "yargs";

const args = yargs(process.argv.slice(2)).argv;


async function getSancorInvoice() {
  const invoiceInformation = await invoiceAgent({ url: "https://www.sancorsalud.com.ar/login/asociados" });
  return invoiceInformation;
}

async function processAgent(args) {
  console.dir(args, { depth: null });

  switch (args.method) {
    case "getSancorInvoice":
      try {
        const invoiceInfo = await getSancorInvoice();
        console.log("Invoice Information:", invoiceInfo);
      } catch (err) {
        console.log(`processAgent::getSancorInvoice::Error condition found: ${err}`);
        process.exitCode = 1;
      }
      break;
    default:
      console.log("No job has been run");
      break;
  }
}

processAgent(args);