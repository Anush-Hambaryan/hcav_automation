// scrape-khoy.js
const { chromium, errors } = require('playwright');
const path = require('path');
const fs = require('fs');

const downloadDir = '/Users/anushhambaryan/Documents/hcav_automation.nosync/marzpetaran/syunik';
const baseURL = "http://syunik.mtad.am/";
const type = "decisions" // decisions for marzpeti voroshumner
const years = ["2026", "2025", "2024", "2023"];
let pageIndex = parseInt(process.argv[2]) || 1;
const pageLimit = parseInt(process.argv[3]) || 1000;

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
  while (true) {
    try {
      await mainLogic();
      break; // success
    } catch (error) {
      if (error instanceof errors.TimeoutError) {
        console.log("⏰ Timeout detected");
        console.log(`Retrying from page ${pageIndex} in 5s...`);
        await delay(5000);       
        continue;
      }
      console.log("Error in run", error);
      break;
    }
  }
}

run();

async function mainLogic() {

  const browser = await chromium.launch({ headless: true});
  const context = await browser.newContext({
    acceptDownloads: true
  });
  const page = await context.newPage();

  let stop = false;
  while (!stop && pageIndex <= pageLimit) {
    // Go to page
    console.log("pageIndex", pageIndex)
    await page.goto(`${baseURL}/${type}/page/${pageIndex}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const rows = page.locator('#content p:has(+ *:has-text("Ընդունված է"))');
    const rowCount = await rows.count();
    if (rowCount < 1) break;

    const tasks = [];
    for (let i = 0; i < rowCount; i++) {
      const idx = i; 
        tasks.push((async() => {
          const file = rows.nth(idx).locator("a");

          const nextChild = rows.nth(idx).locator('xpath=following-sibling::*[1]');
          const nextChildText = await nextChild.innerText();
          const dateText = nextChildText.split("Ընդունված է` ")[1];

          if (!years.some(item => dateText.includes(item))) stop = true;

          if (!stop) {
            const dateData = dateText.split(".");
            const innerText = await file.innerText()
            const name = innerText.slice(0, 220).trim();
            const url = await file.getAttribute('href');
            const urlArr = url.split(".")
            const ext = urlArr[urlArr.length-1];

            const res = await page.request.get(url, {timeout: 150000});
            if (!res.ok()) throw new Error(`Failed: ${res.status()} ${res.statusText()}`);

            const filePath = `${downloadDir}/${dateData[2]}/${dateData[1]}`;
            fs.mkdirSync(filePath, { recursive: true });
            fs.writeFileSync(path.join(filePath, `${name}.${ext}`), await res.body());
          }
        })());
    }
    await Promise.all(tasks);
    pageIndex++;
  }
    await browser.close();
    console.log('Done.');
};
