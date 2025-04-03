import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";

function App() {
  const [org, setOrg] = useState("");
  const [repos, setRepos] = useState([]);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [selectedRepos, setSelectedRepos] = useState([]);

  useEffect(() => {
    if (!org) return;

    // Check if the server has an authorized token for the organization
    fetch(`/cd/api/auth-status?org=${org}`)
      .then((res) => res.json())
      .then((data) => setIsAuthorized(data.isAuthorized))
      .catch((err) => console.error("Failed to check auth status:", err));
  }, [org]);

  useEffect(() => {
    if (!isAuthorized || !org) return;

    fetch(`/cd/api/repos?org=${org}`)
      .then((res) => {
        if (res.status === 401) {
          setIsAuthorized(false);
          return [];
        }
        return res.json();
      })
      .then(setRepos)
      .catch((err) => console.error("Failed to fetch repos:", err));
  }, [isAuthorized, org]);

  const handleAuthorize = () => {
    window.location.href = `/auth/github?org=${org}`;
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
      body: JSON.stringify({ org, repoNames: selectedRepos }),
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
      <input
        type="text"
        placeholder="Enter organization name"
        value={org}
        onChange={(e) => setOrg(e.target.value)}
        className="mb-4 px-4 py-2 rounded-lg text-black"
      />
      {!isAuthorized ? (
        <button
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400"
          onClick={handleAuthorize}
          disabled={!org}
        >
          Authorize GitHub Organization
        </button>
      ) : (
        <div>
          <h2 className="text-3xl font-bold">Tracked Repositories</h2>
          <ul className="mt-4 space-y-2">
            {repos.map((repo) => (
              <li
                key={repo.id}
                className="text-gray-400 flex justify-between items-center"
              >
                <label>
                  <input
                    type="checkbox"
                    checked={selectedRepos.includes(repo.name)}
                    onChange={() => handleRepoSelection(repo.name)}
                    className="mr-2"
                  />
                  {repo.name}
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
