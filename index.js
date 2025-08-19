import { invoiceAgent } from "./agents/invoiceAgent.js";
const args = yargs(process.argv.slice(2)).argv;


async function getSancorInvoice(dowloadFile) {
  const invoiceInformation = await invoiceAgent({ url: "https://www.sancorsalud.com.ar/login/asociados", dowloadFile});
  return invoiceInformation;
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
    default:
      console.log("No job has been run");
      break;
  }
}

processAgent(args);