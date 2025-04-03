import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  const [repos, setRepos] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accessToken, setAccessToken] = useState(null); // Store the access token
  const [expandedRepoId, setExpandedRepoId] = useState(null); // Track the expanded repo
  const [webhooks, setWebhooks] = useState({}); // Store webhooks for each repo
  const [loading, setLoading] = useState(false); // Track loading state
  const [editingRepoId, setEditingRepoId] = useState(null); // Track the repo being edited
  const [scriptContent, setScriptContent] = useState(""); // Store the script content

  useEffect(() => {
    // Check if the user is authorized and fetch the access token
    fetch("/cd/api/auth-status")
      .then((res) => res.json())
      .then((data) => {
        setIsAuthorized(data.isAuthorized);
        if (data.isAuthorized) {
          setAccessToken(data.accessToken); // Store the access token
        }
      })
      .catch((err) => console.error("Failed to check auth status:", err));
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;

    setLoading(true); // Start loading
    // Fetch all repositories the user has access to
    fetch("/cd/api/repos")
      .then((res) => {
        if (res.status === 401) {
          setIsAuthorized(false);
          return [];
        }
        return res.json();
      })
      .then(setRepos)
      .catch((err) => console.error("Failed to fetch repos:", err))
      .finally(() => setLoading(false)); // Stop loading
  }, [isAuthorized]);

  const handleAuthorize = () => {
    // Always redirect to the GitHub authorization page
    window.location.href = "/cd/api/auth/github";
  };

  const handleReauthorize = () => {
    fetch("/cd/api/reauthorize", {
      method: "POST",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to clear access token.");
        }
        return res.json();
      })
      .then(() => {
        setIsAuthorized(false); // Reset the authorization state
        setAccessToken(null); // Clear the access token in the frontend
        handleAuthorize(); // Redirect to GitHub authorization page
      })
      .catch((err) => console.error("Failed to reauthorize:", err));
  };

  const toggleRepoExpansion = (repo) => {
    if (expandedRepoId === repo.id) {
      setExpandedRepoId(null); // Collapse if already expanded
      return;
    }

    setExpandedRepoId(repo.id); // Expand the selected repo

    // Fetch webhooks for the selected repository from the server
    fetch(`/cd/api/repos/${repo.owner.login}/${repo.name}/hooks`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch webhooks.");
        }
        return res.json();
      })
      .then((data) =>
        setWebhooks((prev) => ({
          ...prev,
          [repo.id]: data,
        }))
      )
      .catch((err) => console.error("Failed to fetch webhooks:", err));
  };

  const setupWebhook = (repo) => {
    fetch("/cd/api/add-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repoName: repo.full_name }), // Send a single repository name
    })
      .then((res) => {
        if (!res.ok) {
          return res.json().then((error) => {
            throw new Error(error.details?.message || "Failed to add webhook.");
          });
        }
        return res.json();
      })
      .then(() => {
        toggleRepoExpansion(repo); // Refresh webhook details
      })
      .catch((err) => {
        console.error("Failed to add webhook:", err.message);
        alert(`Failed to add webhook: ${err.message}`); // Display error to the user
      });
  };

  const fetchScript = (repo) => {
    const url = `/cd/api/repos/${repo.owner.login}/${repo.name}/script`;
    console.log(`Fetching script from: ${url}`); // Log the request URL
    fetch(url)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch script.");
        }
        return res.json();
      })
      .then((data) => setScriptContent(data.script || ""))
      .catch((err) => console.error("Failed to fetch script:", err));
  };

  const saveScript = (repo) => {
    fetch(`/cd/api/repos/${repo.owner.login}/${repo.name}/script`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script: scriptContent }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to save script.");
        }
        return res.json();
      })
      .then(() => {
        alert("Script saved successfully.");
        setEditingRepoId(null); // Exit editing mode
      })
      .catch((err) => {
        console.error("Failed to save script:", err);
        alert("Failed to save script.");
      });
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 text-gray-900 px-4">
      {!isAuthorized ? (
        <button
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
          onClick={handleAuthorize}
        >
          Authorize GitHub
        </button>
      ) : (
        <div className="w-full max-w-4xl p-6 bg-white rounded-lg shadow-md">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-semibold">Repositories</h2>
            <button
              className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
              onClick={handleReauthorize}
            >
              Reauthorize
            </button>
          </div>
          {loading ? (
            <div className="text-center text-gray-500">
              Loading repositories...
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  className={`p-4 border rounded-md shadow-sm cursor-pointer ${
                    expandedRepoId === repo.id
                      ? "bg-blue-50 border-blue-500"
                      : "bg-gray-100 border-gray-200"
                  }`}
                  onClick={() => toggleRepoExpansion(repo)}
                >
                  <h3
                    className="text-lg font-medium truncate"
                    title={repo.full_name} // Show full name on hover
                  >
                    {repo.full_name}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {repo.description || "No description"}
                  </p>

                  {expandedRepoId === repo.id && (
                    <div className="mt-4">
                      <h4 className="text-md font-semibold mb-2">Webhooks</h4>
                      <ul className="space-y-2">
                        {webhooks[repo.id]?.length > 0 ? (
                          webhooks[repo.id].map((webhook) => (
                            <li
                              key={webhook.id}
                              className="p-3 border rounded-md bg-gray-50 text-gray-800"
                            >
                              <p>
                                <strong>URL:</strong> {webhook.config.url}
                              </p>
                              <p>
                                <strong>Events:</strong>{" "}
                                {webhook.events.join(", ")}
                              </p>
                              <p>
                                <strong>Status:</strong>{" "}
                                {webhook.active ? "Active" : "Inactive"}
                              </p>
                            </li>
                          ))
                        ) : (
                          <p className="text-gray-500">No webhooks found.</p>
                        )}
                      </ul>
                      <button
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        onClick={() => setupWebhook(repo)}
                      >
                        Setup Webhook
                      </button>
                      <button
                        className="mt-4 ml-2 px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                        onClick={() => {
                          setEditingRepoId(repo.id);
                          fetchScript(repo);
                        }}
                      >
                        Edit Script
                      </button>
                      {editingRepoId === repo.id && (
                        <div className="mt-4">
                          <h4 className="text-md font-semibold mb-2">
                            Edit Script
                          </h4>
                          <textarea
                            className="w-full p-2 border rounded-md"
                            rows="6"
                            value={scriptContent}
                            onChange={(e) => setScriptContent(e.target.value)}
                            placeholder="Enter your bash script here..."
                          />
                          <div className="flex mt-2">
                            <button
                              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400"
                              onClick={() => saveScript(repo)}
                            >
                              Save Script
                            </button>
                            <button
                              className="ml-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400"
                              onClick={() => setEditingRepoId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
