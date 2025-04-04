import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import ViteExpress from "vite-express";
import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const TOKEN_PATH = process.env.GITHUB_TOKEN_PATH;
const HOST = process.env.HOST;
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve("./scripts"); // Use env variable or default to ./scripts

if (!TOKEN_PATH) {
  throw new Error("Environment variable GITHUB_TOKEN_PATH is required.");
}

if (!HOST) {
  throw new Error("Environment variable HOST is required.");
}

if (!SCRIPTS_DIR) {
  throw new Error("Environment variable SCRIPTS_DIR is required.");
}

let accessToken = null; // Store the single access token for the authenticated user

// Ensure the scripts directory exists
await fs.mkdir(SCRIPTS_DIR, { recursive: true });

console.log(`Scripts directory: ${SCRIPTS_DIR}`); // Log the scripts directory path

// Redirect to GitHub authorization page
app.get("/cd/api/auth/github", (req, res) => {
  const redirectUri = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=repo,read:org,admin:repo_hook&redirect_uri=${HOST}/cd/api/github/callback`;
  res.redirect(redirectUri);
});

// Handle GitHub OAuth callback
app.get("/cd/api/github/callback", async (req, res) => {
  const { code } = req.query;

  if (!code) {
    console.error("GitHub OAuth callback: Missing code parameter.");
    return res.status(400).send("Missing code parameter.");
  }

  try {
    console.log("GitHub OAuth callback: Received code:", code);

    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error("GitHub OAuth callback: Error from GitHub:", tokenData);
      throw new Error(
        tokenData.error_description || "Failed to obtain access token"
      );
    }

    accessToken = tokenData.access_token;
    console.log("GitHub access token obtained successfully.");

    // Save the token response to a file
    await fs.writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2));
    console.log(`Token response saved to ${TOKEN_PATH}`);

    res.redirect(`${HOST}/cd`);
  } catch (error) {
    console.error("Error during GitHub OAuth callback:", error.message);
    res.status(500).send("Authorization failed. Please try again.");
  }
});

// Clear the access token to allow reauthorization
app.post("/cd/api/reauthorize", async (req, res) => {
  try {
    accessToken = null; // Clear the in-memory token
    await fs.unlink(TOKEN_PATH); // Remove the token file if it exists
    console.log("Access token cleared. Ready for reauthorization.");
    res.status(200).json({ message: "Reauthorization ready." });
  } catch (error) {
    if (error.code === "ENOENT") {
      // File does not exist, proceed without error
      console.log("Token file not found. Proceeding with reauthorization.");
      res.status(200).json({ message: "Reauthorization ready." });
    } else {
      console.error("Failed to clear access token:", error.message);
      res.status(500).json({ error: "Failed to clear access token." });
    }
  }
});

// Check if the server has an authorized token
app.get("/cd/api/auth-status", async (req, res) => {
  if (!accessToken) {
    try {
      // Load the token from the file if not in memory
      const tokenData = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
      accessToken = tokenData.access_token;
      console.log(`Loaded access token from ${TOKEN_PATH}`);
    } catch (error) {
      console.error("Failed to load access token from file:", error.message);
    }
  }
  res.json({ isAuthorized: !!accessToken }); // Do not send the accessToken to the frontend
});

// Fetch all repositories the authenticated user has access to
app.get("/cd/api/repos", async (req, res) => {
  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    // Fetch personal repositories
    const userReposResponse = await fetch(
      "https://api.github.com/user/repos?type=all", // Include type=all to fetch personal repos
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!userReposResponse.ok) {
      throw new Error(
        `GitHub API responded with status ${userReposResponse.status} for user repos`
      );
    }

    const userRepos = await userReposResponse.json();

    // Fetch organizations the user belongs to
    const orgsResponse = await fetch("https://api.github.com/user/orgs", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!orgsResponse.ok) {
      throw new Error(
        `GitHub API responded with status ${orgsResponse.status} for user orgs`
      );
    }

    const orgs = await orgsResponse.json();

    // Fetch repositories for each organization
    const orgReposPromises = orgs.map((org) =>
      fetch(`https://api.github.com/orgs/${org.login}/repos`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `GitHub API responded with status ${response.status} for org ${org.login} repos`
          );
        }
        return response.json();
      })
    );

    const orgReposResults = await Promise.all(orgReposPromises);
    const orgRepos = orgReposResults.flat(); // Flatten the array of arrays

    // Combine personal and organization repositories
    const allRepos = [...userRepos, ...orgRepos];
    res.json(allRepos);
  } catch (error) {
    console.error("Error fetching repositories:", error.message);
    res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

// Fetch webhooks for a specific repository
app.get("/cd/api/repos/:owner/:repo/hooks", async (req, res) => {
  const { owner, repo } = req.params;

  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API responded with status ${response.status} for fetching hooks`
      );
    }

    const hooks = await response.json();
    res.json(hooks);
  } catch (error) {
    console.error("Error fetching webhooks:", error.message);
    res.status(500).json({ error: "Failed to fetch webhooks." });
  }
});

// Remove a webhook from a specific repository
app.delete("/cd/api/repos/:owner/:repo/hooks/:hookId", async (req, res) => {
  const { owner, repo, hookId } = req.params;

  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    console.log(`Removing webhook ${hookId} from ${owner}/${repo}`); // Log the webhook removal

    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/hooks/${hookId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to remove webhook. GitHub responded with status ${response.status}`
      );
    }

    res
      .status(200)
      .json({ message: `Webhook ${hookId} removed successfully.` });
  } catch (error) {
    console.error(
      `Error removing webhook ${hookId} from ${owner}/${repo}:`,
      error.message
    );
    res.status(500).json({ error: "Failed to remove webhook." });
  }
});

// Add a webhook to a single repository
app.post("/cd/api/add-webhook", async (req, res) => {
  const { repoName } = req.body;

  if (!accessToken || !repoName) {
    return res
      .status(400)
      .send("Access token and a repository name are required.");
  }

  try {
    const webhookUrl = `${HOST}/cd/api/webhook`; // Use HOST for webhook URL
    const webhookPayload = {
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: webhookUrl,
        content_type: "json",
      },
    };

    console.log(`Installing webhook for ${repoName}:`, webhookPayload); // Log webhook details

    const response = await fetch(
      `https://api.github.com/repos/${repoName}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(webhookPayload),
      }
    );

    const responseBody = await response.json();

    if (!response.ok) {
      console.error(
        `Failed to add webhook to ${repoName}. Status: ${response.status}, Response:`,
        responseBody
      );
      return res.status(response.status).json({
        error: `Failed to add webhook to ${repoName}.`,
        details: responseBody,
      });
    }

    res.status(201).json({ message: `Webhook added to ${repoName}` });
  } catch (error) {
    console.error("Error adding webhook:", error.message);
    res.status(500).json({ error: "Failed to add webhook." });
  }
});

// Update or create a bash script for a specific repository
app.post("/cd/api/repos/:owner/:repo/script", async (req, res) => {
  const { owner, repo } = req.params;
  const { script } = req.body;

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner}_${repo}.sh`);
    console.log(`Saving script to: ${scriptPath}`); // Log the script path
    await fs.writeFile(scriptPath, script || "", { mode: 0o755 }); // Write empty file if script is empty
    console.log(`Script saved successfully for ${owner}/${repo}`);
    res.status(200).json({ message: "Script updated successfully." });
  } catch (error) {
    console.error(`Error saving script for ${owner}/${repo}:`, error.message);
    res.status(500).json({ error: "Failed to update script." });
  }
});

// Get the bash script for a specific repository
app.get("/cd/api/repos/:owner/:repo/script", async (req, res) => {
  const { owner, repo } = req.params;

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner}_${repo}.sh`);
    console.log(`Fetching script from: ${scriptPath}`); // Log the script path
    const script = await fs.readFile(scriptPath, "utf-8");
    res.status(200).json({ script });
  } catch (error) {
    if (error.code === "ENOENT") {
      console.warn(
        `Script not found for ${owner}/${repo}. Returning empty script.`
      );
      return res.status(200).json({ script: "" }); // Return empty script if not found
    }
    console.error(`Error reading script for ${owner}/${repo}:`, error.message);
    res.status(500).json({ error: "Failed to read script." });
  }
});

// Execute the bash script when the webhook is triggered
app.post("/cd/api/webhook", async (req, res) => {
  const { repository, ref } = req.body;

  if (!repository || !repository.owner || !repository.name || !ref) {
    return res.status(400).json({ error: "Invalid webhook payload." });
  }

  const branch = ref.split("/").pop(); // Extract branch name from ref (e.g., "refs/heads/main")
  const { owner, name: repo } = repository;

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner.login}_${repo}.sh`);
    const workingDir = path.join(SCRIPTS_DIR, `${owner.login}_${repo}`); // Use a subdirectory for the repo
    const repoUrl = `https://github.com/${owner.login}/${repo}.git`;

    console.log(
      `Webhook triggered for ${owner.login}/${repo} on branch ${branch}`
    );
    console.log(`Working directory: ${workingDir}`);
    console.log(`Script path: ${scriptPath}`);

    // Ensure the working directory exists
    await fs.mkdir(workingDir, { recursive: true });

    // Clone or pull the repository
    const gitCommand = `
      cd ${workingDir} &&
      if [ -d ".git" ]; then
        git pull origin ${branch};
      else
        git clone --branch ${branch} ${repoUrl} .;
      fi
    `;

    const gitProcess = exec(gitCommand);

    // Stream git operation output
    gitProcess.stdout.on("data", (data) => {
      console.log(`Git output: ${data}`);
      res.write(`Git output: ${data}`);
    });

    gitProcess.stderr.on("data", (data) => {
      console.error(`Git error: ${data}`);
      res.write(`Git error: ${data}`);
    });

    gitProcess.on("close", (code) => {
      if (code !== 0) {
        console.error(`Git process exited with code ${code}`);
        res.end(`Git process failed with code ${code}`);
        return;
      }

      console.log("Git operation completed successfully.");

      // Run the script
      const scriptProcess = exec(`bash ${scriptPath}`, { cwd: workingDir });

      // Stream script execution output
      scriptProcess.stdout.on("data", (data) => {
        console.log(`Script output: ${data}`);
        res.write(`Script output: ${data}`);
      });

      scriptProcess.stderr.on("data", (data) => {
        console.error(`Script error: ${data}`);
        res.write(`Script error: ${data}`);
      });

      scriptProcess.on("close", (code) => {
        if (code !== 0) {
          console.error(`Script process exited with code ${code}`);
          res.end(`Script process failed with code ${code}`);
          return;
        }

        console.log("Script executed successfully.");
        res.end("Script executed successfully.");
      });
    });
  } catch (error) {
    console.error("Error handling webhook:", error.message);
    res.status(500).json({ error: "Failed to handle webhook." });
  }
});

// Run the script for a specific repository
app.post("/cd/api/repos/:owner/:repo/run-script", async (req, res) => {
  const { owner, repo } = req.params;
  const { branch, workingDir } = req.body;

  if (!branch || !workingDir) {
    return res
      .status(400)
      .json({ error: "Branch and working directory are required." });
  }

  try {
    const repoUrl = `https://github.com/${owner}/${repo}.git`;
    const scriptPath = path.join(SCRIPTS_DIR, `${owner}_${repo}.sh`);

    // Ensure the working directory exists
    await fs.mkdir(workingDir, { recursive: true });

    // Clone or pull the repository
    const gitCommand = `
      cd ${workingDir} &&
      if [ -d ".git" ]; then
        git pull origin ${branch};
      else
        git clone --branch ${branch} ${repoUrl} .;
      fi
    `;

    exec(gitCommand, async (error, stdout, stderr) => {
      if (error) {
        console.error(`Git operation failed: ${stderr}`);
        return res
          .status(500)
          .json({ error: "Failed to clone or pull repository." });
      }

      console.log(`Git operation output: ${stdout}`);

      // Run the script
      exec(
        `bash ${scriptPath}`,
        { cwd: workingDir },
        (error, stdout, stderr) => {
          if (error) {
            console.error(`Script execution failed: ${stderr}`);
            return res.status(500).json({ error: "Failed to execute script." });
          }

          console.log(`Script executed successfully: ${stdout}`);
          res.status(200).json({ message: stdout });
        }
      );
    });
  } catch (error) {
    console.error("Error running script:", error.message);
    res.status(500).json({ error: "Failed to run script." });
  }
});

// Fetch branches for a specific repository
app.get("/cd/api/repos/:owner/:repo/branches", async (req, res) => {
  const { owner, repo } = req.params;

  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/branches`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(
        `GitHub API responded with status ${response.status} for fetching branches`
      );
    }

    const branches = await response.json();
    res.json(branches);
  } catch (error) {
    console.error("Error fetching branches:", error.message);
    res.status(500).json({ error: "Failed to fetch branches." });
  }
});

// Save configuration for a specific repository
app.post("/cd/api/repos/:owner/:repo/config", async (req, res) => {
  const { owner, repo } = req.params;
  const { script, branch, workingDir } = req.body;

  if (!branch || !workingDir) {
    return res
      .status(400)
      .json({ error: "Branch and working directory are required." });
  }

  try {
    const configPath = path.join(SCRIPTS_DIR, `${owner}_${repo}_config.json`);
    const config = { script, branch, workingDir };

    console.log(`Saving configuration to: ${configPath}`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration saved successfully for ${owner}/${repo}`);
    res.status(200).json({ message: "Configuration saved successfully." });
  } catch (error) {
    console.error(
      `Error saving configuration for ${owner}/${repo}:`,
      error.message
    );
    res.status(500).json({ error: "Failed to save configuration." });
  }
});

ViteExpress.listen(app, PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
