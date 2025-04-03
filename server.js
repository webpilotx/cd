import "dotenv/config";
import express from "express";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import ViteExpress from "vite-express";

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

const orgTokens = {}; // Map to store access tokens for multiple organizations

// Redirect to GitHub authorization page
app.get("/auth/github", (req, res) => {
  const { org } = req.query;
  if (!org) {
    return res.status(400).send("Organization name is required.");
  }
  const redirectUri = `https://github.com/login/oauth/authorize?client_id=${CLIENT_ID}&scope=repo,read:org,admin:repo_hook&redirect_uri=http://localhost:3000/cd/api/github/callback?org=${org}`;
  res.redirect(redirectUri);
});

// Handle GitHub OAuth callback
app.get("/cd/api/github/callback", async (req, res) => {
  const { code, org } = req.query;

  if (!org) {
    return res.status(400).send("Organization name is required.");
  }

  try {
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
      throw new Error(
        tokenData.error_description || "Failed to obtain access token"
      );
    }

    orgTokens[org] = tokenData.access_token; // Store the token for the organization
    console.log(`GitHub access token obtained successfully for ${org}.`);

    res.redirect("/"); // Redirect to the frontend after successful authorization
  } catch (error) {
    console.error("Error during GitHub OAuth:", error.message);
    res.status(500).send("Authorization failed.");
  }
});

// Check if the server has an authorized token for an organization
app.get("/cd/api/auth-status", (req, res) => {
  const { org } = req.query;
  if (!org) {
    return res.status(400).send("Organization name is required.");
  }
  res.json({ isAuthorized: !!orgTokens[org] });
});

// Fetch repositories in the organization
app.get("/cd/api/repos", async (req, res) => {
  const { org } = req.query;
  if (!org) {
    return res.status(400).send("Organization name is required.");
  }

  const accessToken = orgTokens[org];
  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    const response = await fetch(`https://api.github.com/orgs/${org}/repos`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded with status ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error(`Error fetching repositories for ${org}:`, error.message);
    res.status(500).json({ error: "Failed to fetch repositories" });
  }
});

// Add webhooks to multiple repositories
app.post("/cd/api/add-webhook", async (req, res) => {
  const { org, repoNames } = req.body;

  if (!org || !repoNames || !Array.isArray(repoNames)) {
    return res
      .status(400)
      .send("Organization and an array of repository names are required.");
  }

  const accessToken = orgTokens[org];
  if (!accessToken) {
    return res
      .status(401)
      .json({ error: "Unauthorized. Please authorize first." });
  }

  try {
    const webhookUrl = `${req.protocol}://${req.get("host")}/cd/api/webhook`;
    const results = [];

    for (const repoName of repoNames) {
      const response = await fetch(
        `https://api.github.com/repos/${org}/${repoName}/hooks`,
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

      if (response.ok) {
        results.push({ repoName, status: "success" });
      } else {
        results.push({
          repoName,
          status: "failed",
          error: response.statusText,
        });
      }
    }

    res.status(201).json({ message: "Webhook processing completed.", results });
  } catch (error) {
    console.error(`Error adding webhooks for ${org}:`, error.message);
    res.status(500).json({ error: "Failed to add webhooks." });
  }
});

ViteExpress.listen(app, 3000, () => console.log("Server is listening..."));
