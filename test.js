import puppeteer from 'puppeteer';

async function runTest() {
  const browser = await puppeteer.launch();
  console.log('Browser launched');
  await browser.close();
  console.log('Browser closed');
}

runTest();
