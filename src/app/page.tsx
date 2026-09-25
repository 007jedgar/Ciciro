"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import ThemePicker from "@/components/ThemePicker";
import AccountBar from "@/components/AccountBar";
import BrandMark from "@/components/BrandMark";
import { IMPORT_ACCEPT, uploadImport } from "@/lib/import-client";

type ProjectSummary = {
  id: string;
  title: string;
  author: string;
  genre: string;
  updatedAt: string;
  folderId?: string | null;
  _count: { chapters: number };
};

type FolderSummary = {
  id: string;
  name: string;
  notes: string;
  projects: ProjectSummary[];
  _count: { projects: number };
};

function chapterLabel(count: number) {
  return `${count} chapter${count === 1 ? "" : "s"}`;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function ProjectCard({
  project,
  folders,
  onOpen,
  onMove,
}: {
  project: ProjectSummary;
  folders: FolderSummary[];
  onOpen: (id: string) => void;
  onMove: (projectId: string, folderId: string | null) => void;
}) {
  return (
    <div className="project-card">
      <button type="button" className="project-card-main" onClick={() => onOpen(project.id)}>
        <h3>{project.title}</h3>
        <div className="meta">
          {project.author || "Unknown author"}
          {project.genre ? ` - ${project.genre}` : ""} - {chapterLabel(project._count.chapters)}
        </div>
      </button>
      <div className="project-card-actions">
        {folders.length > 0 ? (
          <select
            aria-label={`Move ${project.title} to a folder`}
            value={project.folderId ?? ""}
            onChange={(event) => onMove(project.id, event.target.value || null)}
          >
            <option value="">Unfiled</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="btn ghost small" onClick={() => onOpen(project.id)}>
          Open
        </button>
      </div>
    </div>
  );
}

function FolderBlock({
  folder,
  folders,
  unfiled,
  onOpen,
  onMove,
  onAdd,
  onDelete,
}: {
  folder: FolderSummary;
  folders: FolderSummary[];
  unfiled: ProjectSummary[];
  onOpen: (id: string) => void;
  onMove: (projectId: string, folderId: string | null) => void;
  onAdd: (folderId: string, projectId: string) => void;
  onDelete: (folder: FolderSummary) => void;
}) {
  const [addingId, setAddingId] = useState("");
  return (
    <section className="folder-block" aria-labelledby={`folder-${folder.id}`}>
      <div className="folder-head">
        <div>
          <h2 id={`folder-${folder.id}`}>{folder.name}</h2>
          {folder.notes ? <p className="folder-notes">{folder.notes}</p> : null}
          <p className="folder-count">
            {folder._count.projects} manuscript{folder._count.projects === 1 ? "" : "s"}
          </p>
        </div>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => onDelete(folder)}
        >
          Delete folder
        </button>
      </div>
      {folder.projects.length === 0 ? (
        <p className="folder-empty">No manuscripts in this folder yet.</p>
      ) : (
        folder.projects.map((project) => (
          <ProjectCard
            key={project.id}
            project={{ ...project, folderId: folder.id }}
            folders={folders}
            onOpen={onOpen}
            onMove={onMove}
          />
        ))
      )}
      {unfiled.length > 0 ? (
        <form
          className="folder-add"
          onSubmit={(event) => {
            event.preventDefault();
            if (!addingId) return;
            onAdd(folder.id, addingId);
            setAddingId("");
          }}
        >
          <select
            aria-label={`Add a manuscript to ${folder.name}`}
            value={addingId}
            onChange={(event) => setAddingId(event.target.value)}
          >
            <option value="">Add a manuscript...</option>
            {unfiled.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
          <button className="btn small" type="submit" disabled={!addingId}>
            Add
          </button>
        </form>
      ) : null}
    </section>
  );
}

export default function Home() {
  const router = useRouter();
  const pathname = usePathname();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [genre, setGenre] = useState("");
  const [folderId, setFolderId] = useState("");
  const [creating, setCreating] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderNotes, setFolderNotes] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importTitle, setImportTitle] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [shelf, setShelf] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    const [nextProjects, nextFolders] = await Promise.all([
      fetchJson("/api/projects"),
      fetchJson("/api/folders"),
    ]);
    if (Array.isArray(nextProjects)) setProjects(nextProjects);
    if (Array.isArray(nextFolders)) setFolders(nextFolders);
    setShelf(
      Array.isArray(nextProjects) && Array.isArray(nextFolders) ? "ready" : "error"
    );
  }, []);

  useEffect(() => {
    if (pathname !== "/") return;
    void load().catch(() => {});
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void load().catch(() => {});
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [load, pathname]);

  const unfiled = projects.filter((project) => !project.folderId);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({
        title,
        author,
        genre,
        ...(folderId ? { folderId } : {}),
      }),
    });
    const project = await res.json();
    router.push(`/project/${project.id}`);
  }

  async function importManuscript(e: React.FormEvent) {
    e.preventDefault();
    if (!importFile || importing) return;
    setImporting(true);
    setImportError("");
    try {
      const result = await uploadImport(importFile, {
        title: importTitle.trim(),
        author,
        ...(folderId ? { folderId } : {}),
      });
      router.push(`/project/${result.projectId}`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed.");
      setImporting(false);
    }
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!folderName.trim() || creatingFolder) return;
    setCreatingFolder(true);
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ name: folderName, notes: folderNotes }),
    });
    setCreatingFolder(false);
    if (!res.ok) return;
    setFolderName("");
    setFolderNotes("");
    await load();
  }

  async function moveProject(projectId: string, nextFolderId: string | null) {
    await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ folderId: nextFolderId }),
    });
    await load();
  }

  async function addToFolder(nextFolderId: string, projectId: string) {
    await fetch(`/api/folders/${nextFolderId}/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store",
      body: JSON.stringify({ projectIds: [projectId] }),
    });
    await load();
  }

  async function removeFolder(folder: FolderSummary) {
    const ok = window.confirm(
      `Delete “${folder.name}”? Manuscripts stay in your library, unfiled.`
    );
    if (!ok) return;
    await fetch(`/api/folders/${folder.id}`, {
      method: "DELETE",
      credentials: "include",
      cache: "no-store",
    });
    await load();
  }

  function openProject(id: string) {
    router.push(`/project/${id}`);
  }

  return (
    <div className="home">
      <div className="home-top">
        <div className="brand-lockup">
          <BrandMark size={44} />
          <h1>Ciciro</h1>
        </div>
        <div className="account-bar">
          <AccountBar />
          <ThemePicker />
        </div>
      </div>
      <p className="tag">Your AI writing partner - plan it, write it, ship the manuscript.</p>

      {shelf === "loading" ? <p className="tag">Loading manuscripts…</p> : null}
      {shelf === "error" ? (
        <p className="tag" role="alert">
          Couldn&apos;t load manuscripts. Refresh to try again.
        </p>
      ) : null}

      {folders.map((folder) => (
        <FolderBlock
          key={folder.id}
          folder={folder}
          folders={folders}
          unfiled={unfiled}
          onOpen={openProject}
          onMove={moveProject}
          onAdd={addToFolder}
          onDelete={removeFolder}
        />
      ))}

      {(unfiled.length > 0 || folders.length === 0) && projects.length > 0 ? (
        <div>
          {folders.length > 0 ? <h2 className="shelf-heading">Unfiled</h2> : null}
          {(folders.length > 0 ? unfiled : projects).map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              folders={folders}
              onOpen={openProject}
              onMove={moveProject}
            />
          ))}
        </div>
      ) : null}

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
        {folders.length > 0 ? (
          <select
            aria-label="Folder"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
          >
            <option value="">No folder</option>
            {folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        ) : null}
        <button className="btn primary" type="submit" disabled={creating}>
          {creating ? "Creating..." : "Create manuscript"}
        </button>
      </form>

      <form className="new-form" onSubmit={importManuscript}>
        <strong>Import a manuscript</strong>
        <p className="folder-notes">
          Word (.docx, including Google Docs downloaded as Word), Markdown, or a zipped Scrivener
          project. Chapters split on headings; bold, italic and scene breaks carry over.
        </p>
        <input
          type="file"
          accept={IMPORT_ACCEPT}
          aria-label="Manuscript file"
          onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
        />
        <input
          placeholder="Title (optional, defaults to the file's)"
          value={importTitle}
          onChange={(e) => setImportTitle(e.target.value)}
        />
        {importError ? <p role="alert">{importError}</p> : null}
        <button className="btn" type="submit" disabled={importing || !importFile}>
          {importing ? "Importing..." : "Import manuscript"}
        </button>
      </form>

      <form className="new-form" onSubmit={createFolder}>
        <strong>New folder</strong>
        <input
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          required
        />
        <textarea
          placeholder="Notes (optional)"
          value={folderNotes}
          onChange={(e) => setFolderNotes(e.target.value)}
          rows={3}
        />
        <button className="btn" type="submit" disabled={creatingFolder || !folderName.trim()}>
          {creatingFolder ? "Creating..." : "Create folder"}
        </button>
      </form>
    </div>
  );
}
