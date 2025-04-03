import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import ViteExpress from "vite-express";
import fs from "fs/promises";
import path from "path";

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

    const response = await fetch(
      `https://api.github.com/repos/${repoName}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push"],
          config: {
            url: webhookUrl,
            content_type: "json",
          },
        }),
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

  if (!script) {
    return res.status(400).json({ error: "Script content is required." });
  }

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner}_${repo}.sh`);
    await fs.writeFile(scriptPath, script, { mode: 0o755 }); // Save script with executable permissions
    res.status(200).json({ message: "Script updated successfully." });
  } catch (error) {
    console.error("Error updating script:", error.message);
    res.status(500).json({ error: "Failed to update script." });
  }
});

// Get the bash script for a specific repository
app.get("/cd/api/repos/:owner/:repo/script", async (req, res) => {
  const { owner, repo } = req.params;

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner}_${repo}.sh`);
    const script = await fs.readFile(scriptPath, "utf-8");
    res.status(200).json({ script });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res.status(404).json({ error: "Script not found." });
    }
    console.error("Error reading script:", error.message);
    res.status(500).json({ error: "Failed to read script." });
  }
});

// Execute the bash script when the webhook is triggered
app.post("/cd/api/webhook", async (req, res) => {
  const { repository } = req.body;

  if (!repository || !repository.owner || !repository.name) {
    return res.status(400).json({ error: "Invalid webhook payload." });
  }

  const { owner, name: repo } = repository;

  try {
    const scriptPath = path.join(SCRIPTS_DIR, `${owner.login}_${repo}.sh`);
    await fs.access(scriptPath); // Check if the script exists

    const { exec } = await import("child_process");
    exec(`bash ${scriptPath}`, (error, stdout, stderr) => {
      if (error) {
        console.error(
          `Error executing script for ${owner.login}/${repo}:`,
          stderr
        );
        return res.status(500).json({ error: "Failed to execute script." });
      }
      console.log(`Script executed for ${owner.login}/${repo}:`, stdout);
      res.status(200).json({ message: "Script executed successfully." });
    });
  } catch (error) {
    if (error.code === "ENOENT") {
      return res
        .status(404)
        .json({ error: "Script not found for this repository." });
    }
    console.error("Error handling webhook:", error.message);
    res.status(500).json({ error: "Failed to handle webhook." });
  }
});

ViteExpress.listen(app, PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
