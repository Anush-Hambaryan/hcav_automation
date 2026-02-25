
const { chromium, errors } = require('playwright');
const path = require('path');

const downloadDir = '/Users/anushhambaryan/Documents/hcav_automation.nosync/test';
const baseURL = "https://docs.ejmiatsin.am/Pages/DocFlow/Default.aspx";
const type = "Voroshum" // "Voroshum" for mayor, "CouncilorDecision" for city council
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
    await page.goto(`${baseURL}?dt=${type}&Grd=Page$${pageIndex}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const rows = page.locator('table.dfGrid tbody tr');
    const rowCount = await rows.count();
    if (rowCount < 1) break;

    const tasks = [];
    for (let i = 1; i < rowCount; i++) {
      const idx = i; 
        tasks.push((async() => {
          const row = rows.nth(idx);
          const cells = row.locator('td');

          // Extract name, doc code, and year text
          const name = (await cells.nth(2).innerText()).replace(/[\/\\]+/g, '-').slice(0, 220)
          const docCode = (await cells.nth(0).innerText()).trim()
          const yearText = (await cells.nth(1).innerText()).trim();

          // Check if the year text contains any of the specified years
          if (!years.some(year => yearText.includes(year))) stop = true;

          if (!stop) {
            // Click the first cell to open the document page
            const clickTarget = cells.nth(0).locator('a, button, input[type="button"], img').first();
            await clickTarget.isVisible({ timeout: 30000 })
            await clickTarget.evaluate(el => el.setAttribute("target", "_blank")); 

            const href = await clickTarget.getAttribute('href');
            const newPage = await page.context().newPage();
            await newPage.goto(baseURL+href);
            await newPage.waitForLoadState('domcontentloaded');

            // Download file and appendices
            await downloadFile(newPage, downloadDir, docCode, name, yearText);
            await downloadAppendix(newPage, docCode, yearText, downloadDir);
          }
        })());
    }
    await Promise.all(tasks);
    pageIndex++;
  }
    await browser.close();
    console.log('Done.');
};


async function downloadFile (page, downloadDir, docCode, name, yearText) {
    // Wait for the print button to be visible
    const printButton = page.locator('input[type="image"][title*="պել"][title*="րոշում"]:not([title*="աղվածք"])').first();
    // const printButton = page.locator('#ctl00_ContentPlaceHolder1_ctl01_ctl00_btn');

    await printButton.waitFor({ state: 'visible', timeout: 3000 });

    // Click the print button and wait for the popup
    const popupPromise = page.waitForEvent('popup');
    await printButton.click({ timeout: 10000 })
    const popup = await popupPromise;
  
    await popup.waitForLoadState('domcontentloaded', { timeout: 5000 });
    await popup.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});

    // Wait for the export button to be visible
    const exportBtn = popup.locator('input[name="ImageButton1"]');
    await exportBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Click the export button and wait for the download
    const downloadPromise = popup.waitForEvent('download', { timeout: 100000 });
    await exportBtn.click({ timeout: 50000 });
    const download = await downloadPromise;
    const finalPath = path.join(
      downloadDir,
      yearText.split("/")[2],
      yearText.split("/")[1],
      `${docCode}_${name}.pdf`
    );

    // Save the downloaded file 
    await download.saveAs(finalPath);

    // Close the popup
    await popup.close().catch(() => {});
}


async function downloadAppendix(page, docCode, yearText, downloadDir) {
    const label = page.getByText('Կից փաստաթղթեր՝', { exact: true });
    const td = label.locator('xpath=following-sibling::*[1]');

    const links = td.locator('a');
    const count = await links.count();

    if (count === 0) {
      page.close();
      return;
    };

    for (let i = 0; i < count; i += 1) {
      const a = links.nth(i);

      await a.evaluate(el => {
        el.setAttribute('download', '');
      });

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 100000 }),
        a.click(),
      ]);

      const href = await a.getAttribute('href');
      const ext = href.split(".")[1]
      const num = i + 1;
      const finalPath = path.join(
        downloadDir,
        yearText.split("/")[2],
        yearText.split("/")[1],
        `${docCode}_Հավելված_${num}.${ext}`
      );
      await download.saveAs(finalPath);
    }
    page.close();
}