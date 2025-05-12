#!/usr/bin/env node

const { Command } = require("commander");
const { execSync, exec } = require("child_process");
const os = require("os");
const fs = require("fs");
const { createObjectCsvWriter } = require("csv-writer");
const nodemailer = require("nodemailer"); // For email alerts

const program = new Command();

// Command-line options
program
  .option("-i, --interval <minutes>", "Interval between tests in minutes", "15")
  .option("-o, --output <file>", "Output CSV file", "log.csv")
  .option("--ping-threshold <ms>", "Ping threshold for alerts", parseInt)
  .option(
    "--download-threshold <Mbps>",
    "Download speed threshold for alerts",
    parseFloat
  )
  .option(
    "--upload-threshold <Mbps>",
    "Upload speed threshold for alerts",
    parseFloat
  )
  .option("--email <email>", "Email address for alerts");

// Parse command-line arguments
program.parse(process.argv);
const options = program.opts();
const intervalMs = parseInt(options.interval, 10) * 60 * 1000;

// 🛠 Check if speedtest-cli is installed
function checkSpeedtestInstalled() {
  try {
    // Check if speedtest-cli is installed by running its version command
    execSync("speedtest-cli --version", { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

// Auto-install for macOS via Homebrew (only if needed)
function installSpeedtest() {
  if (os.platform() === "darwin") {
    try {
      console.log("📦 Checking if Homebrew is installed...");

      // Check if Homebrew is installed
      execSync("brew --version", { stdio: "ignore" });
      console.log("✅ Homebrew is installed.");

      console.log("📦 Installing speedtest-cli via Homebrew...");
      execSync("brew install speedtest-cli", { stdio: "inherit" });
      console.log("✅ speedtest-cli installed successfully!");
    } catch (err) {
      console.error(
        "❌ Homebrew is not installed. Please install Homebrew first: https://brew.sh"
      );
      process.exit(1); // Exit if Homebrew is not installed
    }
  } else {
    console.error(
      "❌ Auto-install only supported on macOS. Install speedtest-cli manually on your OS."
    );
    process.exit(1); // Exit for non-macOS systems
  }
}

// Check if speedtest-cli is installed
if (!checkSpeedtestInstalled()) {
  console.log("❌ speedtest-cli not found. Attempting installation...");
  installSpeedtest(); // Try installing speedtest-cli
} else {
  console.log("✅ speedtest-cli is already installed.");
}
// ✅ Ensure speedtest-cli is available only if the feature is enabled
if (
  !checkSpeedtestInstalled() &&
  (options.pingThreshold ||
    options.downloadThreshold ||
    options.uploadThreshold)
) {
  installSpeedtest();
}

// 📁 Prepare CSV writer only if output is specified
const csvWriter = options.output
  ? createObjectCsvWriter({
      path: options.output,
      header: [
        { id: "timestamp", title: "Timestamp" },
        { id: "ping", title: "Ping (ms)" },
        { id: "download", title: "Download (Mbps)" },
        { id: "upload", title: "Upload (Mbps)" },
      ],
      append: fs.existsSync(options.output),
    })
  : null;

console.log(`🔄 Running speed test every ${options.interval} minutes...`);
console.log(`📁 Logging to: ${options.output || "none"}`);

// 🚀 Run speedtest and log to CSV
function runSpeedTest() {
  return new Promise((resolve, reject) => {
    exec("speedtest-cli --json", (err, stdout) => {
      if (err) return reject(new Error("Failed to run speedtest-cli"));

      try {
        const result = JSON.parse(stdout);
        const entry = {
          timestamp: new Date().toLocaleString("en-US", {
            weekday: "long", // Day of the week
            year: "numeric", // Full year
            month: "long", // Full month name
            day: "numeric", // Day of the month
            hour: "2-digit", // Hour in 2-digit format
            minute: "2-digit", // Minute in 2-digit format
            second: "2-digit", // Second in 2-digit format
          }),
          ping: result.ping,
          download: (result.download / 1e6).toFixed(2), // Convert to Mbps
          upload: (result.upload / 1e6).toFixed(2), // Convert to Mbps
        };
        resolve(entry);
      } catch (parseErr) {
        reject(new Error("Could not parse speedtest-cli output"));
      }
    });
  });
}

// 🧑‍💻 Send email notification if a threshold is exceeded
function sendEmailAlert(entry) {
  if (options.email) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: "your-email@gmail.com", // Replace with your email
        pass: "your-email-password", // Replace with your email password or use an App Password
      },
    });

    const mailOptions = {
      from: "your-email@gmail.com",
      to: options.email,
      subject: "⚠️ Speed Alert: Threshold Exceeded",
      text: `
        Speed test results:
        Timestamp: ${entry.timestamp}
        Ping: ${entry.ping} ms
        Download: ${entry.download} Mbps
        Upload: ${entry.upload} Mbps
        
        One or more thresholds were exceeded.
      `,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("❌ Failed to send email:", error);
      } else {
        console.log(`📧 Email alert sent: ${info.response}`);
      }
    });
  }
}

// 🚨 Check if thresholds are exceeded
function checkThresholds(entry) {
  if (
    (options.pingThreshold && entry.ping > options.pingThreshold) ||
    (options.downloadThreshold && entry.download < options.downloadThreshold) ||
    (options.uploadThreshold && entry.upload < options.uploadThreshold)
  ) {
    console.log("⚠️ Threshold exceeded! Sending email alert...");
    sendEmailAlert(entry);
  }
}

async function logSpeed() {
  try {
    const data = await runSpeedTest();
    if (csvWriter) {
      await csvWriter.writeRecords([data]);
      console.log(`✅ Logged at ${data.timestamp}`);
    }

    // Check if the speed test results exceed thresholds
    checkThresholds(data);
  } catch (err) {
    console.error("❌ Speed test failed:", err.message);
  }
}

// ⏱ Run immediately and on interval
logSpeed();
setInterval(logSpeed, intervalMs);
