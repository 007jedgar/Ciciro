import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import Workspace from "@/components/Workspace";
import type { Project } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      chapters: { orderBy: { order: "asc" } },
      characters: { orderBy: { name: "asc" } },
      plotPoints: { orderBy: { order: "asc" } },
    },
  });

  if (!project) notFound();

  return <Workspace initialProject={project as unknown as Project} />;
}
