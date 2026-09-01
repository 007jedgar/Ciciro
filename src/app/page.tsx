"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ThemePicker from "@/components/ThemePicker";
import AccountBar from "@/components/AccountBar";

type ProjectSummary = {
  id: string;
  title: string;
  author: string;
  genre: string;
  updatedAt: string;
  _count: { chapters: number };
};

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, author, genre }),
    });
    const project = await res.json();
    router.push(`/project/${project.id}`);
  }

  return (
    <div className="home">
      <div className="home-top">
        <h1>Ciciro</h1>
        <div className="account-bar">
          <AccountBar />
          <ThemePicker />
        </div>
      </div>
      <p className="tag">Your AI writing partner - plan it, write it, ship the manuscript.</p>

      {projects.length > 0 && (
        <div>
          {projects.map((p) => (
            <div
              key={p.id}
              className="project-card"
              onClick={() => router.push(`/project/${p.id}`)}
              role="button"
            >
              <div>
                <h3>{p.title}</h3>
                <div className="meta">
                  {p.author || "Unknown author"}
                  {p.genre ? ` - ${p.genre}` : ""} - {p._count.chapters} chapter
                  {p._count.chapters === 1 ? "" : "s"}
                </div>
              </div>
              <span className="btn ghost small">Open</span>
            </div>
          ))}
        </div>
      )}

      <form className="new-form" onSubmit={create}>
        <strong>Start a new manuscript</strong>
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Author name"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <input
          placeholder="Genre (optional)"
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={creating}>
          {creating ? "Creating..." : "Create manuscript"}
        </button>
      </form>
    </div>
  );
}
