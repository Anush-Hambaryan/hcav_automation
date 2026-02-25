
const { chromium, errors } = require('playwright');
const path = require('path');
const fs = require('fs');

const downloadDir = '/Users/anushhambaryan/Documents/hcav_automation.nosync/test/yerevan';
const baseURL = "https://www.yerevan.am";
const type = "mayors-decisions" // elders-decisions for avagani
const year = parseInt(process.argv[2]) || 2025;

let month = 1; // January, 

const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function run() {
  while (true) {
    try {
      await mainLogic();
      break; // success
    } catch (error) {
      if (error instanceof errors.TimeoutError) {
        console.log("⏰ Timeout detected");
        console.log(`Retrying from month ${month} in 5s...`);
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


  while (month <=12) {
    let pageIndex = 1;
    while (true) {
      const filePath = `${downloadDir}/${year}/${month}`;
      // Go to page
      console.log("year", year, "month", month, "pageIndex", pageIndex);
      await page.goto(`${baseURL}/hy/${type}/archive/${year}/${month}/?page=${pageIndex}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      const rows = page.locator('.announcements-section').first().locator(':scope > .discussion-section');
      const rowCount = await rows.count();
      if (rowCount < 1) break;

      const tasks = [];
      for (let i = 0; i < rowCount; i++) {
        const idx = i; 
          tasks.push((async() => {
            const a = rows.nth(idx).locator("a");

            // Extract file name and code
            const pInnerText = rows.nth(idx).locator("p").last();
            const fileName = (await pInnerText.innerText()).replace("ԵՐԵՎԱՆԻ ՔԱՂԱՔԱՊԵՏ ՈՐՈՇՈՒՄ", "").trim().replace("\n", " ")
            const rawCodeFromFileName = fileName.slice(0, 3);

            // Go to doc page
            const url = await a.getAttribute('href');
            const newPage = await page.context().newPage();
            await newPage.goto(baseURL+url);
            await newPage.waitForLoadState('domcontentloaded');

            // Extract code from url
            const urlArr = newPage.url().split("/");
            const codeFull = urlArr[urlArr.length-1] || urlArr[urlArr.length-2];
            const rawCodeFromUrl = codeFull.split("-")[0];
           
            const regex = new RegExp(`(${rawCodeFromUrl}|${rawCodeFromFileName})-.{1}`);
            let elem, code, aChildCount;
            try {
              // Find the elem containing the code to extract full code
              elem = newPage.locator('p').filter({ hasText: regex }).first();
              const elemCount = await elem.count();
              const text = elemCount > 0 ? await elem.innerText() : "";
              const match = text.match(regex);
              code = match ? match[0] : rawCode;

              // Check if code is in a link
              const aChild = elem.locator("a");
              aChildCount = await aChild.count();
            } catch (err) {
              throw err
            }
                  
            if (!aChildCount) {
              await newPage.pdf({
                path: `${filePath}/${fileName.slice(0, 220).replace(/[\/\\]/g, '-')}.pdf`,
                format: 'A4',          
                printBackground: true, 
                margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
                preferCSSPageSize: true,
              });
            }
          
            const mainDoc = newPage.locator('.discussion-section').first();
            const aElems = mainDoc.locator('a[href]');
            const aElemsCount = await aElems.count();

            // download all links
            let appendix = 1;
            for (let i = 0; i < aElemsCount; i++) {
              const a = aElems.nth(i);
              const ahref = await aElems.nth(i).getAttribute('href');
              const cleanPart = ahref.split("uploads/")[1];
              const fileUrl = cleanPart ? `${baseURL}/uploads/${cleanPart}` : `${baseURL}${ahref}`;
              const fileUrlArr = fileUrl.split(".")
              const innerText = await a.innerText();
              let name = innerText.slice(0, 220).replace(/[\/\\]/g, '-').trim();
              if (!name.includes(code)) {
                name = `${code}_Հավելված_${appendix}`;
                appendix++;
              }
              const ext = fileUrlArr[fileUrlArr.length-1];

              // await newPage.waitForTimeout(2000);
              await downloadWithRetry(newPage, fileUrl, filePath, name, ext);
            }
            await newPage.close();

            })());
      }
      await Promise.all(tasks);
      pageIndex++;
    }
    month++;
  }
    await browser.close();
    console.log('Done.');
};


async function downloadWithRetry(page, fileUrl, dirPath, name, ext, retries = 4) {
  fs.mkdirSync(dirPath, { recursive: true });
  const outPath = path.join(dirPath, `${name}.${ext}`);

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await page.request.get(fileUrl, {
        timeout: 150000,
        headers: {
          'Accept': 'application/pdf,application/octet-stream;q=0.9,*/*;q=0.8',
          'Referer': page.url(),
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36',
        },
      });

      if (!res.ok()) throw new Error(`HTTP ${res.status()} ${res.statusText()}`);

      fs.writeFileSync(outPath, await res.body());
      return;
    } catch (e) {
      console.log("error", e.message)
      lastErr = e;
      // small exponential backoff
      await page.waitForTimeout(1000 * attempt);
    }
  }

  throw lastErr;
}
