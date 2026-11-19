import assert from "node:assert/strict";
import { test } from "node:test";
import { collectStagingConfiguration } from "./dev-staging.mjs";

const productionSessionSecret = "production-session-secret-0123456789abcdef";
const restaurantId = "123e4567-e89b-12d3-a456-426614174000";

function queuedReader(values) {
  return async () => values.shift();
}

test("reads and trims the staging URL once, then re-prompts other invalid inputs", async () => {
  const messages = [];
  const productionEnv = {
    SUPABASE_URL: "https://prod-project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "production-service-key",
    ADMIN_PASSWORD: "production-admin-password",
    ADMIN_SESSION_SECRET: productionSessionSecret,
  };
  const lineAnswers = [
    "  https://staging-project.supabase.co  ",
    "",
    "NO",
    "STAGING",
    "",
    "not-a-uuid",
    restaurantId,
    undefined,
    "staging-admin@example.invalid",
  ];
  const secretAnswers = [
    "",
    "production-service-key",
    "staging-test-service-key",
    "",
    "production-admin-password",
    "staging-test-admin-password",
    "",
    "too-short",
    productionSessionSecret,
    "staging-session-secret-0123456789abcdef",
  ];

  const staging = await collectStagingConfiguration({
    productionEnv,
    readLine: queuedReader(lineAnswers),
    readSecret: queuedReader(secretAnswers),
    notify: (message) => messages.push(message),
  });

  assert.equal(staging.SUPABASE_URL, "https://staging-project.supabase.co");
  assert.equal(staging.SUPABASE_SERVICE_ROLE_KEY, "staging-test-service-key");
  assert.equal(staging.SUPABASE_RESTAURANT_ID, restaurantId);
  assert.equal(staging.ADMIN_EMAIL, "staging-admin@example.invalid");
  assert.equal(staging.ADMIN_PASSWORD, "staging-test-admin-password");
  assert.equal(
    staging.ADMIN_SESSION_SECRET,
    "staging-session-secret-0123456789abcdef",
  );
  assert.ok(messages.some((message) => message.includes("is required")));
  assert.ok(messages.some((message) => message.includes("matches .env.local")));
  assert.ok(messages.some((message) => message.includes("must be a UUID")));
  assert.ok(messages.some((message) => message.includes("at least 32 characters")));
  for (const secret of secretAnswers.filter(Boolean)) {
    assert.ok(messages.every((message) => !message.includes(secret)));
  }
});

test("a missing staging URL fails after one prompt", async () => {
  let urlPrompts = 0;
  let secretPrompts = 0;

  await assert.rejects(
    collectStagingConfiguration({
      productionEnv: {
        SUPABASE_URL: "https://prod-project.supabase.co",
      },
      readLine: async () => {
        urlPrompts += 1;
        return undefined;
      },
      readSecret: async () => {
        secretPrompts += 1;
        return "unused";
      },
    }),
    /Staging Supabase URL is required/,
  );
  assert.equal(urlPrompts, 1);
  assert.equal(secretPrompts, 0);
});

test("an invalid or production URL fails after one prompt", async () => {
  for (const [url, message] of [
    ["not a URL", /Invalid staging Supabase URL/],
    ["https://prod-project.supabase.co", /matches \.env\.local/],
  ]) {
    let urlPrompts = 0;
    await assert.rejects(
      collectStagingConfiguration({
        productionEnv: {
          SUPABASE_URL: "https://prod-project.supabase.co",
        },
        readLine: async () => {
          urlPrompts += 1;
          return url;
        },
        readSecret: async () => "unused",
      }),
      message,
    );
    assert.equal(urlPrompts, 1);
  }
});
