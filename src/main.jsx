import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  const [repos, setRepos] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState([]);

  useEffect(() => {
    // Check if the user is authorized
    fetch("/cd/api/auth-status")
      .then((res) => res.json())
      .then((data) => setIsAuthorized(data.isAuthorized))
      .catch((err) => console.error("Failed to check auth status:", err));
  }, []);

  useEffect(() => {
    if (!isAuthorized) return;

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

  const handleRepoSelection = (repoName) => {
    setSelectedRepos((prev) =>
      prev.includes(repoName)
        ? prev.filter((name) => name !== repoName)
        : [...prev, repoName]
    );
  };

  const addWebhooks = () => {
    fetch("/cd/api/add-webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ repoNames: selectedRepos }),
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to add webhooks.");
        }
        return res.json();
      })
      .then((data) => {
        alert("Webhook processing completed.");
        console.log(data.results);
      })
      .catch((err) => console.error("Failed to add webhooks:", err));
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
        <div>
          <h2 className="text-3xl font-bold">Available Repositories</h2>
          <ul className="mt-4 space-y-2">
            {repos.map((repo) => (
              <li
                key={repo.id}
                className="text-gray-400 flex justify-between items-center"
              >
                <label>
                  <input
                    type="checkbox"
                    checked={selectedRepos.includes(repo.full_name)}
                    onChange={() => handleRepoSelection(repo.full_name)}
                    className="mr-2"
                  />
                  {repo.full_name}
                </label>
              </li>
            ))}
          </ul>
          <button
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400"
            onClick={addWebhooks}
            disabled={selectedRepos.length === 0}
          >
            Add Webhooks to Selected Repositories
          </button>
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
