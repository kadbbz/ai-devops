import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { plan } from "../api/fixtures";
const authFile = resolve(".data/test/session.json");
const slug = "e2e-" + Date.now().toString(36);
test.describe.serial("PRD 人类工作台", () => {
  test("统一身份默认密码提示可忽略", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("进入你的交付工作台")).toBeVisible();
    await page.getByRole("link", { name: "用户名密码登录" }).click();
    await page.locator('input[name="user_name"]').fill("admin");
    await page.locator('input[name="password"]').fill("admin");
    await page.locator("form button").last().click();
    const authorize = page.getByRole("button", {
      name: /应用授权|Authorize Application/,
    });
    if (await authorize.isVisible().catch(() => false)) await authorize.click();
    await expect(page.getByText("待办与 Intent", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText("当前仍在使用默认密码")).toBeVisible();
    await page.getByRole("button", { name: "本次忽略" }).click();
    await expect(page.getByText("当前仍在使用默认密码")).toHaveCount(0);
    await page.context().storageState({ path: authFile });
  });
  test("创建项目、Intent 与 Gate A 方案确认；缺少证据阻止 Gate B 交付候选确认", async ({
    page,
  }) => {
    await page
      .context()
      .addCookies(JSON.parse(readFileSync(authFile, "utf8")).cookies);
    await page.goto("/projects/new");
    await page.getByLabel("项目名称", { exact: true }).fill("真实验收项目");
    await page.getByLabel("仓库标识").fill(slug);
    await page.getByRole("button", { name: "创建项目与受保护仓库" }).click();
    await expect(page).toHaveURL("/", { timeout: 30000 });
    await page
      .getByRole("link", { name: /创建 Intent/ })
      .first()
      .click();
    await page.getByLabel("目标名称").fill("避免重复工单");
    await page.getByLabel("背景与预期结果").fill("并发提交只能创建一张工单。");
    await page.getByRole("button", { name: "创建目标", exact: true }).click();
    await expect(page).toHaveURL(/\/intents\/int_/);
    const intentUrl = page.url();
    await page.getByRole("link", { name: /准备方案/ }).click();
    await page.getByRole("button", { name: "结构化导入" }).click();
    await page
      .getByRole("textbox", { name: "方案草稿", exact: true })
      .fill(JSON.stringify(plan(), null, 2));
    await page.getByRole("button", { name: "保存草稿" }).click();
    await expect(page).toHaveURL(intentUrl);
    await page.getByRole("link", { name: /审阅 Gate A（方案确认）/ }).click();
    await page.getByRole("button", { name: "核对固定对象" }).click();
    await page.getByRole("button", { name: "填写签发决定" }).click();
    await page
      .getByLabel("审查结论与理由")
      .fill("目标、状态改变及恢复方式已核对");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", {
        name: /方案确认：签发目标并创建工作区/,
        exact: true,
      })
      .click();
    await expect(page).toHaveURL(intentUrl, { timeout: 30000 });
    await expect(page.getByText("工作区已确认", { exact: true })).toBeVisible();
    await page
      .getByRole("link", { name: /审阅 Gate B（交付候选确认）/ })
      .click();
    await expect(
      page.getByText("当前尚不可签发", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("缺少当前提交的可信构建")).toBeVisible();
    await page.getByRole("button", { name: "核对固定对象" }).click();
    await page.getByRole("button", { name: "填写签发决定" }).click();
    await expect(
      page.getByRole("button", {
        name: /交付候选确认：签发交付并创建 PR/,
        exact: true,
      }),
    ).toBeDisabled();
  });
  test("运维首备、审计与窄屏布局", async ({ page }) => {
    await page
      .context()
      .addCookies(JSON.parse(readFileSync(authFile, "utf8")).cookies);
    await page.goto("/ops");
    await expect(
      page.getByRole("heading", { name: "已就绪", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("COMPLETED", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText("已完成", { exact: true }).first(),
    ).toBeVisible();
    await page.goto("/audit");
    await expect(
      page.getByText("gate.a", { exact: true }).first(),
    ).toBeVisible();
    await page.goto("/");
    await expect(page.locator("h1")).toBeVisible();
    await page.screenshot({
      path: "doc/test_case/results/desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByText("待办与 Intent", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: "doc/test_case/results/mobile.png",
      fullPage: true,
    });
  });
});
