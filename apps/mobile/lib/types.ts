export type PublicUser = {
  id: string;
  email: string;
  name: string;
};

export type ProjectListItem = {
  id: string;
  title: string;
  author: string;
  genre: string;
  logline: string;
  updatedAt: string;
  _count?: { chapters: number };
};

export type Chapter = {
  id: string;
  title: string;
  order: number;
  content: string;
  summary: string;
  status: string;
  wordCount: number;
};

export type ProjectDetail = {
  id: string;
  title: string;
  author: string;
  genre: string;
  logline: string;
  synopsis: string;
  chapters: Chapter[];
};
