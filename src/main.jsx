import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  const [repos, setRepos] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accessToken, setAccessToken] = useState(null); // Store the access token
  const [expandedRepoId, setExpandedRepoId] = useState(null); // Track the expanded repo
  const [webhooks, setWebhooks] = useState({}); // Store webhooks for each repo

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
      .catch((err) => console.error("Failed to fetch repos:", err));
  }, [isAuthorized]);

  const handleAuthorize = () => {
    window.location.href = "/cd/api/auth/github";
  };

  const toggleRepoExpansion = (repo) => {
    if (expandedRepoId === repo.id) {
      setExpandedRepoId(null); // Collapse if already expanded
      return;
    }

    setExpandedRepoId(repo.id); // Expand the selected repo

    // Fetch webhooks for the selected repository
    fetch(`https://api.github.com/repos/${repo.full_name}/hooks`, {
      headers: { Authorization: `Bearer ${accessToken}` }, // Use the access token
    })
      .then((res) => res.json())
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
      body: JSON.stringify({ repoNames: [repo.full_name] }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to add webhook.");
        }
        return res.json();
      })
      .then(() => {
        alert("Webhook added successfully.");
        toggleRepoExpansion(repo); // Refresh webhook details
      })
      .catch((err) => console.error("Failed to add webhook:", err));
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white">
      {!isAuthorized ? (
        <button
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400"
          onClick={handleAuthorize}
        >
          Authorize GitHub
        </button>
      ) : (
        <div className="w-full max-w-4xl">
          <h2 className="text-3xl font-bold mb-4">Repositories</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {repos.map((repo) => (
              <div
                key={repo.id}
                className={`p-4 border rounded-lg cursor-pointer ${
                  expandedRepoId === repo.id
                    ? "bg-blue-600 text-white"
                    : "bg-gray-800 text-gray-400"
                }`}
                onClick={() => toggleRepoExpansion(repo)}
              >
                <h3 className="text-lg font-semibold">{repo.full_name}</h3>
                <p className="text-sm">
                  {repo.description || "No description"}
                </p>

                {expandedRepoId === repo.id && (
                  <div className="mt-4">
                    <h4 className="text-xl font-bold mb-2">Webhooks</h4>
                    <ul className="space-y-2">
                      {webhooks[repo.id]?.length > 0 ? (
                        webhooks[repo.id].map((webhook) => (
                          <li
                            key={webhook.id}
                            className="p-2 border rounded-lg bg-gray-700 text-gray-300"
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
                        <p className="text-gray-400">No webhooks found.</p>
                      )}
                    </ul>
                    <button
                      className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
                      onClick={() => setupWebhook(repo)}
                    >
                      Setup Webhook
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
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
