import { chromium } from "@playwright/test";
import { detectDefaultRegionFromBrowserInfo } from "../src/hooks/use-server-types";

const cases = [
  { name: "EU timezone beats US locale", locale: "en-US", timezoneId: "Europe/Berlin", expected: "hel1" },
  { name: "US timezone stays US", locale: "en-US", timezoneId: "America/Los_Angeles", expected: "hil" },
  { name: "US timezone beats EU locale", locale: "de-DE", timezoneId: "America/New_York", expected: "hil" },
  { name: "Asia timezone falls to nearest region", locale: "en", timezoneId: "Asia/Dubai", expected: "hel1" },
];

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    for (const testCase of cases) {
      const context = await browser.newContext({
        locale: testCase.locale,
        timezoneId: testCase.timezoneId,
      });
      const page = await context.newPage();
      await page.goto("data:text/html,<html><body>region-test</body></html>");

      const signals = await page.evaluate(() => ({
        locales: navigator.languages,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offsetMinutes: -new Date().getTimezoneOffset(),
      }));

      const detected = detectDefaultRegionFromBrowserInfo(signals);

      if (detected !== testCase.expected) {
        throw new Error(
          `${testCase.name} failed: expected ${testCase.expected}, got ${detected} from ${JSON.stringify(signals)}`,
        );
      }

      console.log(`${testCase.name}: ${detected} ${JSON.stringify(signals)}`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
