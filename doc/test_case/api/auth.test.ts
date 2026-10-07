import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../../src/server.js";
import { MemoryStore } from "../../../src/store.js";
import { tokenHash } from "../../../src/model.js";
import { FakeGitea, seed } from "./fixtures.js";

test("默认密码登录会话返回提示，已改密会话不再提示", async () => {
  const state = seed();
  state.sessions.push(
    {
      id: tokenHash("default-password-session"),
      userId: "owner",
      csrf: "csrf-default",
      defaultPassword: true,
      expiresAt: "2099-01-01T00:00:00Z",
    },
    {
      id: tokenHash("changed-password-session"),
      userId: "owner",
      csrf: "csrf-changed",
      defaultPassword: false,
      expiresAt: "2099-01-01T00:00:00Z",
    },
  );
  const app = await createApp({
    store: new MemoryStore(state),
    git: new FakeGitea(),
    testing: true,
  });
  const session = async (token: string) =>
    app.inject({
      method: "GET",
      url: "/api/session",
      headers: { cookie: `devops_session=${token}` },
    });

  assert.equal(
    (await session("default-password-session")).json().defaultPasswordWarning,
    true,
  );
  assert.equal(
    (await session("changed-password-session")).json().defaultPasswordWarning,
    false,
  );
  await app.close();
});

test("忽略默认密码提示只影响当前会话", async () => {
  const state = seed();
  state.sessions.push({
    id: tokenHash("default-password-session"),
    userId: "owner",
    csrf: "csrf-default",
    defaultPassword: true,
    expiresAt: "2099-01-01T00:00:00Z",
  });
  const app = await createApp({
    store: new MemoryStore(state),
    git: new FakeGitea(),
    testing: true,
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/session/default-password-dismiss",
    headers: {
      cookie: "devops_session=default-password-session",
      "x-csrf-token": "csrf-default",
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: "GET",
        url: "/api/session",
        headers: { cookie: "devops_session=default-password-session" },
      })
    ).json().defaultPasswordWarning,
    false,
  );
  await app.close();
});
