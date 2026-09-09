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
  projectId: string;
  title: string;
  order: number;
  content: string;
  summary: string;
  status: string;
  wordCount: number;
  revision: number;
};

export type Character = {
  id: string;
  projectId: string;
  name: string;
  role: string;
  description: string;
  arc: string;
  notes: string;
};

export type PlotPoint = {
  id: string;
  projectId: string;
  chapterId: string | null;
  title: string;
  description: string;
  type: string;
  status: string;
  order: number;
};

export type ProjectDetail = {
  id: string;
  title: string;
  author: string;
  genre: string;
  logline: string;
  synopsis: string;
  theme?: string;
  pov?: string;
  notes?: string;
  chapters: Chapter[];
  characters?: Character[];
  plotPoints?: PlotPoint[];
};
