import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const authFile = resolve(".data/test/session.json"),
  slug = "e2e-" + Date.now().toString(36);
test.describe.serial("需求与版本工作台", () => {
  test("统一身份默认密码提示可忽略", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "用户名密码登录" }).click();
    await page.locator('input[name="user_name"]').fill("admin");
    await page.locator('input[name="password"]').fill("admin");
    await page.locator("form button").last().click();
    await expect
      .poll(
        async () =>
          (await page
            .getByRole("button", { name: /应用授权|Authorize Application/ })
            .isVisible())
            ? "authorize"
            : (await page.getByRole("navigation").isVisible())
              ? "workspace"
              : "waiting",
        { timeout: 30000 },
      )
      .not.toBe("waiting");
    const authorize = page.getByRole("button", {
      name: /应用授权|Authorize Application/,
    });
    if (await authorize.isVisible()) await authorize.click();
    await expect(
      page.getByRole("heading", { name: "需求", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("当前仍在使用默认密码")).toBeVisible();
    await page.getByRole("button", { name: "本次忽略" }).click();
    await expect(page.getByText("当前仍在使用默认密码")).toHaveCount(0);
    await page.context().storageState({ path: authFile });
  });
  test("仅名称与标识建项目，直接编辑需求状态并创建工作分支和版本", async ({
    page,
  }) => {
    await page
      .context()
      .addCookies(JSON.parse(readFileSync(authFile, "utf8")).cookies);
    await page.goto("/projects/new");
    await expect(
      page.getByText(/Runner|API 测试命令|E2E 测试命令|Gate/),
    ).toHaveCount(0);
    await page.getByLabel("项目名称", { exact: true }).fill("浏览器验收项目");
    await page.getByLabel("仓库标识（选填）").fill(slug);
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await expect(page).toHaveURL("/settings", { timeout: 45000 });
    await page.getByRole("link", { name: "需求", exact: true }).click();
    await page.getByRole("link", { name: "新建需求" }).click();
    await page.getByLabel("需求标题").fill("支持客户导入");
    await page.getByLabel("需求说明").fill("IDE 自行完成接口与 E2E 测试。");
    await page.getByRole("button", { name: "保存需求" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("link", { name: /支持客户导入/ }).click();
    await page.getByLabel("状态", { exact: true }).press("ArrowDown");
    await page.getByTitle("已完成", { exact: true }).click();
    await page.getByRole("button", { name: "保存需求" }).click();
    await expect(page).toHaveURL("/");
    await page.getByRole("link", { name: /支持客户导入/ }).click();
    await page.getByRole("link", { name: "创建关联分支" }).click();
    await page.getByLabel("分支名称").fill("feature/customer");
    await page.getByRole("button", { name: "创建分支", exact: true }).click();
    await expect(page).toHaveURL("/branches");
    await expect(
      page.getByText("feature/customer", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "版本", exact: true }).click();
    await page.getByRole("link", { name: "登记版本" }).click();
    await page.getByLabel("版本名称").fill("v0.1.0");
    await page.getByLabel("变更说明").fill("初始版本记录");
    await page.getByRole("button", { name: "创建版本标签" }).click();
    await expect(page).toHaveURL("/versions");
    await expect(page.getByText("v0.1.0", { exact: true })).toBeVisible();
    await expect(page.getByText(/版本记录不表示已部署/)).toBeVisible();
  });
  test("授权、运维、审计与窄屏布局", async ({ page }) => {
    await page
      .context()
      .addCookies(JSON.parse(readFileSync(authFile, "utf8")).cookies);
    await page.goto("/settings");
    await expect(
      page.getByText(/Gate|Runner|验收环境|配置版本与固定执行策略/),
    ).toHaveCount(0);
    await page.getByRole("link", { name: "授权 IDE / Agent" }).click();
    await page.getByLabel("委托名称").fill("浏览器 IDE");
    await page.getByRole("button", { name: "生成短时凭证" }).click();
    await expect(
      page.getByText("请立即复制，明文只显示这一次。"),
    ).toBeVisible();
    await page.goto("/ops");
    await expect(
      page.getByRole("heading", { name: "已就绪", exact: true }),
    ).toBeVisible();
    await page.goto("/audit");
    await expect(
      page.getByText("requirement.create.completed", { exact: true }).first(),
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
      page.getByRole("heading", { name: "需求", exact: true }),
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
