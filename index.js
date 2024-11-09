const { Telegraf } = require("telegraf");
const Queue = require("queue-promise");
const { Schema, model } = require("mongoose");
const mongoose = require("mongoose");
const { Api, TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { computeCheck } = require("telegram/Password");
require("dotenv/config");

const Topic = model("Topic", new Schema({ topicId: Number }));
const Group = model("Group", new Schema({ groupId: String }));
const Phone = model("Phone", new Schema({ value: String }));
const Session = model("Session", new Schema({ value: String }));
const Target = model(
  "Target",
  new Schema({
    startMessageId: Number,
    endMessageId: Number,
    forwardingActive: Boolean,
  })
);
const SourceChannel = model("SourceChannel", new Schema({ channelId: String }));
const Api_id = model("ApiIid", new Schema({ value: Number }));
const Api_hash = model("ApiHash", new Schema({ value: String }));
const PhoneCodeHash = model("PhoneCodeHash", new Schema({ value: String }));

const URI = process.env.URI;
const bot = new Telegraf(process.env.BOT_TOKEN);
mongoose
  .connect(URI)
  .then(() => console.log("Connected to db"))
  .catch((e) => console.log("Error:\n" + e));

// Queue configuration for bot commands
const queue = new Queue({
  concurrent: 1,
  interval: 1000,
});

bot.start(async (ctx) => {
  queue.enqueue(async () => {
    try {
      await ctx.reply(
        `Hey there👋\n\nTo use me, add me to your channels/groups and grant all permissions.`
      );
    } catch (error) {
      console.log(error);
      await ctx.reply("An error occured");
    }
  });
});

// Command to set the source channel ID
bot.command("setsourcechannel", async (ctx) => {
  const channelId = ctx.message.text.split(" ")[1];
  if (!channelId) return ctx.reply("Channel ID is required.");

  await SourceChannel.updateOne({}, { channelId }, { upsert: true });
  ctx.reply("Source channel ID updated.");
});

// Command to set the target group ID
bot.command("settargetgroup", async (ctx) => {
  const groupId = ctx.message.text.split(" ")[1];
  if (!groupId) return ctx.reply("Group ID is required.");

  await Group.updateOne({}, { groupId }, { upsert: true });
  ctx.reply("Target group ID updated.");
});

// Command to set the target topic ID
bot.command("settargettopic", async (ctx) => {
  const topicId = parseInt(ctx.message.text.split(" ")[1]);
  if (!topicId) return ctx.reply("Topic ID is required.");

  await Topic.updateOne({}, { topicId }, { upsert: true });
  ctx.reply("Target topic ID updated.");
});

// Command to set the start message ID
bot.command("startmessage", async (ctx) => {
  const startMessageId = parseInt(ctx.message.text.split(" ")[1]);
  if (!startMessageId) return ctx.reply("Start message ID is required.");

  await Target.updateOne({}, { startMessageId }, { upsert: true });
  ctx.reply("Start message ID updated.");
});

// Command to set the end message ID
bot.command("endmessage", async (ctx) => {
  const endMessageId = parseInt(ctx.message.text.split(" ")[1]);
  if (!endMessageId) return ctx.reply("End message ID is required.");

  await Target.updateOne({}, { endMessageId }, { upsert: true });
  ctx.reply("End message ID updated.");
});

// Command to start the forwarding process
bot.command("start_forwarding", async (ctx) => {
  try {
    const session = await Session.findOne({});
    if (!session?.value) return await ctx.reply("Please login userbot first.");
    await Target.updateOne({}, { forwardingActive: true }, { upsert: true });
    ctx.reply("Forwarding started.");
    fetchStoreAndForwardMessages(bot, ctx);
  } catch (error) {
    console.log(error);
    await ctx.reply("An error occured");
  }
});

// Command to stop the forwarding process
bot.command("stop_forwarding", async (ctx) => {
  await Target.updateOne({}, { forwardingActive: false }, { upsert: true });
  ctx.reply("Forwarding stopped.");
});

//Command to set api id
bot.command("set_api_id", async (ctx) => {
  try {
    const apiId = parseInt(ctx.message.text.split(" ")[1]);
    if (!apiId) return await ctx.reply("Api id is required");
    await Api_id.updateOne({}, { value: apiId }, { upsert: true });
    await ctx.reply("Api id saved");
  } catch (error) {
    await ctx.reply("An error occured");
    console.log(error);
  }
});

//Command to set api hash
bot.command("set_api_hash", async (ctx) => {
  try {
    const apiHash = ctx.message.text.split(" ")[1];
    if (!apiHash) return await ctx.reply("Api hash is required");
    await Api_hash.updateOne({}, { value: apiHash }, { upsert: true });
    await ctx.reply("Api hash saved");
  } catch (error) {
    await ctx.reply("An error occured");
    console.log(error);
  }
});

//Command to set api hash
bot.command("set_phone", async (ctx) => {
  try {
    const phone = ctx.message.text.split(" ")[1];
    if (!phone) return await ctx.reply("Phone number is required");
    await Phone.updateOne({}, { value: phone }, { upsert: true });
    await ctx.reply("Phone number saved");
  } catch (error) {
    await ctx.reply("An error occured");
    console.log(error);
  }
});

const userbotState = { isTakingCode: false };

const login = async (ctx) => {
  try {
    const apiId = await Api_id.findOne({});
    if (!apiId?.value) return await ctx.reply("First set api id and hash");
    const apiHash = await Api_hash.findOne({});
    if (!apiHash?.value) return await ctx.reply("First set api hash");
    const phone = await Phone.findOne({});
    if (!phone?.value) return await ctx.reply("First set phone number");

    // Initialize Telegram client
    const client = new TelegramClient(
      new StringSession(""),
      Number(apiId.value),
      apiHash.value,
      {
        connectionRetries: 5,
      }
    );

    //Another try/catch in here to switch DC in case of DC errors
    try {
      await client.connect();
      const { phoneCodeHash } = await client.invoke(
        new Api.auth.SendCode({
          phoneNumber: `${phone.value}`,
          apiId: parseInt(apiId.value),
          apiHash: `${apiHash.value}`,
          settings: new Api.CodeSettings({
            allowFlashcall: true,
            currentNumber: true,
            allowAppHash: true,
            allowMissedCall: true,
            logoutTokens: [Buffer.from("arbitrary data here")],
          }),
        })
      );

      await PhoneCodeHash.updateOne(
        {},
        { value: phoneCodeHash },
        { upsert: true }
      );
      userbotState.isTakingCode = true;
      await ctx.reply(
        "Code sent! Check your telegram.\n\nIf your account has a password (2fa), write the password immediately after the password and send it to me.\n\nLike this:\nCode Password\n\nIf you omit or send a wrong password, bot will fail and you have to start all over. "
      );
    } catch (error) {
      if (error.message && error.message.startsWith("PHONE_MIGRATE_")) {
        // Extract the DC ID from the error message
        const dcId = parseInt(error.message.split("_").pop(), 10);

        console.log(`Switching to DC ${dcId} and retrying...`);

        // Update client with the required DC
        client.setDC(dcId);

        try {
          // Retry sending the code after switching DCs
          const { phoneCodeHash } = await client.invoke(
            new Api.auth.SendCode({
              phoneNumber: `${phone.value}`,
              apiId: parseInt(apiId.value),
              apiHash: `${apiHash.value}`,
              settings: new Api.CodeSettings({
                allowFlashcall: true,
                currentNumber: true,
                allowAppHash: true,
                allowMissedCall: true,
                logoutTokens: [Buffer.from("arbitrary data here")],
              }),
            })
          );

          await PhoneCodeHash.updateOne(
            {},
            { value: phoneCodeHash },
            { upsert: true }
          );
          await ctx.reply(
            "Code sent! Check your telegram.\n\nIf your account has a password (2fa), write the password immediately after the password and send it to me.\n\nLike this:\nCode Password\n\nIf you omit or send a wrong password, bot will fail and you have to start all over. "
          );
          userbotState.isTakingCode = true;
        } catch (retryError) {
          console.error("Error sending code after DC switch:", retryError);
          await ctx.reply("Error sending code.");
        }
      } else {
        //For any other error
        console.error("Error sending code:", error);
        await ctx.reply("Error sending code.");
      }
    }
  } catch (error) {
    console.log("Sending code:\n", error);
    await ctx.reply("An error occured");
  }
};

bot.command("login", async (ctx) => {
  await login(ctx);
});

bot.on("message", async (ctx) => {
  try {
    if (userbotState.isTakingCode) {
      const apiId = await Api_id.findOne({});
      if (!apiId?.value) return await ctx.reply("First set api id and hash");
      const apiHash = await Api_hash.findOne({});
      if (!apiHash?.value) return await ctx.reply("First set api hash");
      const phone = await Phone.findOne({});
      if (!phone?.value) return await ctx.reply("First set phone number");
      const phone_code_hash = await PhoneCodeHash.findOne({});

      // Initialize Telegram client
      const client = new TelegramClient(
        new StringSession(""),
        Number(apiId.value),
        apiHash.value,
        {
          connectionRetries: 5,
        }
      );

      let code = null;
      let password = null;

      const message = ctx.message.text.split(" ");
      code = message[0];

      if (message[1]) {
        password = message[1];
      }

      await client.connect();

      try {
        // Attempt to sign in using the code
        result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: `${phone.value}`,
            phoneCodeHash: phone_code_hash.value,
            phoneCode: code,
          })
        );
      } catch (error) {
        if (
          error.code === 401 &&
          error.errorMessage.includes("SESSION_PASSWORD_NEEDED")
        ) {
          // If a password is needed, retrieve the password requirements
          const passwordInfo = await client.invoke(
            new Api.account.GetPassword()
          );

          // Hash the password using the salt from `GetPassword`
          const passwordHashResult = await computeCheck(
            passwordInfo, // password requirements from Telegram
            password // user-supplied plain text password
          );

          // Complete login using `CheckPassword` with the hashed password
          result = await client.invoke(
            new Api.auth.CheckPassword({
              password: passwordHashResult,
            })
          );
        } else {
          await ctx.reply("Error logging in");
          console.log("Error logging in:\n" + error);
        }
      }

      await Session.updateOne(
        {},
        { value: client.session.save() },
        { upsert: true }
      );
      userbotState.isTakingCode = false;
      await ctx.reply("Login successful!.");
    }
  } catch (error) {
    console.log(error);
  }
});

// Placeholder for storing messages in memory
let messagesInMemory = [];

// Main function to check membership, fetch messages with user bot, and forward them with regular bot
async function fetchStoreAndForwardMessages(bot, adminCtx) {
  try {
    const apiId = await Api_id.findOne({});
    if (!apiId?.value) return await ctx.reply("First set api id and hash");
    const apiHash = await Api_hash.findOne({});
    if (!apiHash?.value) return await ctx.reply("First set api hash");
    const phone = await Phone.findOne({});
    if (!phone?.value) return await ctx.reply("First set phone number");

    // Initialize Telegram client
    const userBot = new TelegramClient(
      new StringSession(""),
      Number(apiId.value),
      apiHash.value,
      {
        connectionRetries: 5,
      }
    );

    await userBot.start();
    console.log("User bot connected");

    const target = await Target.findOne({});
    const sourceChannel = await SourceChannel.findOne({});
    const group = await Group.findOne({});
    const topic = await Topic.findOne({});

    if (!target || !sourceChannel || !group || !topic) {
      console.log("Please set the IDs in the database.");
      adminCtx.reply("Please set the IDs in the database.");
      return;
    }

    const { startMessageId, endMessageId } = target;
    const sourceChannelId = sourceChannel.channelId;
    const groupId = group.groupId;
    const topicId = topic.topicId;

    // Check if user bot is a member of the source channel
    const isMember = await userBot
      .getParticipant(sourceChannelId, "me")
      .catch(() => null);
    if (!isMember) {
      console.log("User bot is not a member of the source channel.");
      adminCtx.reply("User bot is not a member of the source channel.");
      return;
    }

    // Fetch and store messages in memory
    for (
      let messageId = startMessageId;
      messageId <= endMessageId;
      messageId++
    ) {
      const message = await userBot.getMessages(sourceChannelId, {
        ids: messageId,
      });
      if (message) {
        messagesInMemory.push(message);
        console.log(`Stored message ID ${messageId} in memory.`);
      } else {
        console.log(`Message ID ${messageId} not found.`);
      }
    }

    // Forward messages from memory with the regular bot
    for (let i = 0; i < messagesInMemory.length; i++) {
      const message = messagesInMemory[i];

      const sendOptions = {
        message_thread_id: topicId,
        caption: message.caption || "",
      };

      try {
        if (message.text) {
          await bot.telegram.sendMessage(groupId, message.text, sendOptions);
        } else if (message.photo) {
          await bot.telegram.sendPhoto(
            groupId,
            message.photo[message.photo.length - 1].file_id,
            sendOptions
          );
        } else if (message.video) {
          await bot.telegram.sendVideo(
            groupId,
            message.video.file_id,
            sendOptions
          );
        } else if (message.audio) {
          await bot.telegram.sendAudio(
            groupId,
            message.audio.file_id,
            sendOptions
          );
        } else if (message.document) {
          await bot.telegram.sendDocument(
            groupId,
            message.document.file_id,
            sendOptions
          );
        } else if (message.animation) {
          await bot.telegram.sendAnimation(
            groupId,
            message.animation.file_id,
            sendOptions
          );
        } else if (message.voice) {
          await bot.telegram.sendVoice(
            groupId,
            message.voice.file_id,
            sendOptions
          );
        } else {
          console.log(`Unsupported message type for ID ${message.id}`);
          await adminCtx.reply(`Unsupported message type for ID ${message.id}`);
        }

        // Notify admin with progress
        const remaining = endMessageId - startMessageId - i;
        adminCtx.reply(
          `Forwarded message ID ${message.id}. Messages remaining: ${remaining}`
        );
      } catch (error) {
        console.error(`Error forwarding message ID ${message.id}:`, error);
        adminCtx.reply(
          `Error forwarding message ID ${message.id}: ${error.message}`
        );
      }
    }

    console.log("All messages have been forwarded.");
    adminCtx.reply("All messages have been forwarded.");
  } catch (error) {
    console.error(
      "Error in fetching, storing, and forwarding messages:",
      error
    );
    adminCtx.reply(
      `Error in fetching, storing, and forwarding messages: ${error.message}`
    );
  }
}

// Set bot commands for Telegram
bot.telegram.setMyCommands([
  { command: "setsourcechannel", description: "Set source channel ID" },
  { command: "settargetgroup", description: "Set target group ID" },
  { command: "settargettopic", description: "Set target topic ID" },
  { command: "startmessage", description: "Set starting message ID" },
  { command: "endmessage", description: "Set ending message ID" },
  { command: "start_forwarding", description: "Start forwarding messages" },
  { command: "stop_forwarding", description: "Stop forwarding messages" },
  { command: "set_api_id", description: "Api id for userbot" },
  { command: "set_api_hash", description: "Api hash for userbot" },
  {
    command: "set_phone",
    description: "Set userbot phone number, with area code (+1, +129, etc)",
  },
  { command: "login", description: "Login userbot" },
]);

// Start bot and log a message when connected
bot.telegram
  .getMe()
  .then((botInfo) => {
    console.log(`Bot ${botInfo.username} is connected and running.`);
    bot.launch();
  })
  .catch((err) => {
    console.error("Error connecting bot:", err);
  });
