import { NextRequest, NextResponse } from "next/server";
import { readApiRequest, apiError, textField } from "@/lib/http";
import { downloadRegister, listProjects } from "@/lib/asite";
import type { AsiteFile } from "@/lib/asite-types";
import { parseRegister } from "@/lib/register-parser";
import { isE1FolderName, isExplicitNonShopFile } from "@/lib/folder-rules";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: NextRequest) {
  try {
    const {body, token, region, authType} = await readApiRequest(request);
    const projectId = textField(body, "projectId");
    const file = body.file as AsiteFile | undefined;
    if (!file || typeof file.name !== "string" || typeof file.folderPath !== "string" || !/\.xlsx$/i.test(file.name) || isExplicitNonShopFile(file.name) || !file.folderPath.split(/[\\/]/).some(name => isE1FolderName(name))) throw new Error("Only Excel shop drawing registers in E1 folders can be imported.");
    const projects = await listProjects(token, region, authType);
    const project = projects.find(p => p.id === projectId);
    if (!project) throw new Error("This project is not accessible from the current Asite account.");
    const data = await downloadRegister(token, region, projectId, file, authType);
    const result = await parseRegister(data, { sourceFile: `${file.folderPath}/${file.name}`, project: project.name });
    return NextResponse.json(result);
  } catch (error) { return apiError(error); }
}
