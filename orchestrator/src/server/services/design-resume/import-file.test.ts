import { AppError } from "@infra/errors";
import type { DesignResumeDocument, DesignResumeJson } from "@shared/types";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDefaultReactiveResumeDocument } from "../resume-data/document";

const modelSelection = vi.hoisted(() => ({
  resolveLlmModel: vi.fn(),
}));

const designResumeService = vi.hoisted(() => ({
  replaceCurrentDesignResumeDocument: vi.fn(),
}));

const requestContext = vi.hoisted(() => ({
  getRequestContext: vi.fn(() => ({ requestId: "req-123" })),
  getRequestId: vi.fn(() => "req-123"),
}));

const { callJsonMock } = vi.hoisted(() => ({
  callJsonMock: vi.fn(),
}));

vi.mock("@server/services/modelSelection", () => modelSelection);
vi.mock("./index", () => designResumeService);
vi.mock("@server/infra/request-context", () => requestContext);
vi.mock("pdf-parse", () => ({
  default: vi.fn(),
}));
// Never spawn the real Claude CLI from unit tests.
vi.mock("@server/services/llm/claude-cli/client", () => ({
  ClaudeCliClient: class {
    callJson = callJsonMock;
  },
}));

import { createDesignResumeDocument } from "@shared/testing/factories";
import pdfParse from "pdf-parse";
import { importDesignResumeFromFile } from "./import-file";

const pdfParseMock = vi.mocked(pdfParse);

function makeResumeDocument(
  resumeJson: DesignResumeJson = buildDefaultReactiveResumeDocument() as DesignResumeJson,
): DesignResumeDocument {
  return createDesignResumeDocument({ resumeJson });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function makeDocxBase64(lines: string[]): Promise<string> {
  const zip = new JSZip();
  const paragraphs = lines
    .map(
      (line) => `
    <w:p>
      <w:r>
        <w:t>${escapeXml(line)}</w:t>
      </w:r>
    </w:p>`,
    )
    .join("");
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}
  </w:body>
</w:document>`,
  );
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer.toString("base64");
}

function pdfInput(overrides: { dataBase64?: string; fileName?: string } = {}) {
  return {
    fileName: overrides.fileName ?? "resume.pdf",
    mediaType: "application/pdf",
    dataBase64:
      overrides.dataBase64 ?? Buffer.from("pdf-data").toString("base64"),
  };
}

function claudePrompt(): string {
  const request = callJsonMock.mock.calls[0]?.[0];
  return String(request?.messages?.[1]?.content ?? "");
}

describe("importDesignResumeFromFile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelSelection.resolveLlmModel.mockResolvedValue("opus:medium");
    pdfParseMock.mockResolvedValue({
      text: "Taylor Quinn\nSoftware Engineer",
    } as never);
    callJsonMock.mockResolvedValue({
      text: '{"basics":{"name":"Taylor Quinn"}}',
    });
    designResumeService.replaceCurrentDesignResumeDocument.mockImplementation(
      async ({ resumeJson }: { resumeJson: DesignResumeJson }) =>
        makeResumeDocument(resumeJson),
    );
  });

  it("extracts PDF text locally, asks Claude for the CV and saves the normalized document", async () => {
    callJsonMock.mockResolvedValue({
      text: `\`\`\`json
{
  "basics": { "name": "Taylor Quinn" },
  "sections": {
    "experience": {
      "items": [
        { "company": "", "position": "Ignored" },
        {
          "company": "Acme",
          "position": "Engineer",
          "period": "2023-2025",
          "description": "<p>Built product features.</p>"
        }
      ]
    }
  }
}
\`\`\``,
    });

    const result = await importDesignResumeFromFile(pdfInput());

    expect(pdfParseMock).toHaveBeenCalledOnce();
    expect(callJsonMock).toHaveBeenCalledOnce();
    expect(callJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "opus:medium",
        jsonSchema: expect.objectContaining({ name: "design_resume_import" }),
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("You extract a resume"),
          }),
          expect.objectContaining({ role: "user" }),
        ],
      }),
    );
    expect(claudePrompt()).toContain("The resume file was uploaded as PDF");
    expect(claudePrompt()).toContain("File name: resume.pdf");
    expect(claudePrompt()).toContain("Taylor Quinn\nSoftware Engineer");
    // Only the extracted text is sent, never the raw file.
    expect(claudePrompt()).not.toContain(
      Buffer.from("pdf-data").toString("base64"),
    );

    expect(
      designResumeService.replaceCurrentDesignResumeDocument,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMode: null,
        sourceResumeId: null,
        language: null,
        resumeJson: expect.objectContaining({
          basics: expect.objectContaining({
            name: "Taylor Quinn",
          }),
        }),
      }),
    );

    const savedInput =
      designResumeService.replaceCurrentDesignResumeDocument.mock.calls[0]?.[0];
    const experienceItems =
      savedInput?.resumeJson?.sections?.experience?.items ?? [];

    expect(experienceItems).toHaveLength(1);
    expect(experienceItems[0]).toMatchObject({
      company: "Acme",
      position: "Engineer",
      hidden: false,
    });
    expect(result.title).toBe("Taylor Resume");
  });

  it("extracts DOCX text locally before sending it to Claude", async () => {
    const docxBase64 = await makeDocxBase64([
      "Taylor Quinn",
      "Senior Engineer",
    ]);

    await importDesignResumeFromFile({
      fileName: "resume.docx",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      dataBase64: docxBase64,
    });

    expect(pdfParseMock).not.toHaveBeenCalled();
    expect(callJsonMock).toHaveBeenCalledOnce();
    expect(claudePrompt()).toContain("The resume file was uploaded as DOCX");
    expect(claudePrompt()).toContain("Taylor Quinn");
    expect(claudePrompt()).toContain("Senior Engineer");
    expect(claudePrompt()).not.toContain(docxBase64);
  });

  it("stores a secondary-language CV in its language slot", async () => {
    await importDesignResumeFromFile({ ...pdfInput(), language: "en" });

    expect(
      designResumeService.replaceCurrentDesignResumeDocument,
    ).toHaveBeenCalledWith(expect.objectContaining({ language: "en" }));
  });

  it("repairs JSON with unescaped quotes inside description fields", async () => {
    callJsonMock.mockResolvedValue({
      text: `{"basics":{"name":"Taylor Quinn"},"sections":{"experience":{"items":[{"company":"Acme","position":"Engineer","description":"<ul><li>Led the "Employer Line" program.</li></ul>"}]}}}`,
    });

    await importDesignResumeFromFile(pdfInput());

    const savedInput =
      designResumeService.replaceCurrentDesignResumeDocument.mock.calls[0]?.[0];
    const experienceItems =
      savedInput?.resumeJson?.sections?.experience?.items ?? [];

    expect(experienceItems).toHaveLength(1);
    expect(experienceItems[0]).toMatchObject({
      company: "Acme",
      position: "Engineer",
      description: '<ul><li>Led the "Employer Line" program.</li></ul>',
    });
  });

  it("accepts supported media types even when the file name has no extension", async () => {
    const result = await importDesignResumeFromFile(
      pdfInput({ fileName: "resume" }),
    );

    expect(result.title).toBe("Taylor Resume");
    expect(callJsonMock).toHaveBeenCalledOnce();
  });

  it("infers the file type from the extension when the browser sends a generic type", async () => {
    const docxBase64 = await makeDocxBase64(["Taylor Quinn"]);

    await importDesignResumeFromFile({
      fileName: "cv.DOCX",
      mediaType: "application/octet-stream",
      dataBase64: docxBase64,
    });

    expect(pdfParseMock).not.toHaveBeenCalled();
    expect(claudePrompt()).toContain("The resume file was uploaded as DOCX");
  });

  it("rejects file types other than PDF and DOCX", async () => {
    await expect(
      importDesignResumeFromFile({
        fileName: "resume.txt",
        mediaType: "text/plain",
        dataBase64: Buffer.from("Taylor Quinn").toString("base64"),
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Only PDF and DOCX resumes are supported.",
    });

    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("allows a base64 payload exactly at the 10 MB limit", async () => {
    const exactLimitPayload = Buffer.alloc(10 * 1024 * 1024, 0);

    await expect(
      importDesignResumeFromFile(
        pdfInput({ dataBase64: exactLimitPayload.toString("base64") }),
      ),
    ).resolves.toMatchObject({
      id: "primary",
    });
  });

  it("rejects payloads over the 10 MB limit", async () => {
    const overLimitPayload = Buffer.alloc(10 * 1024 * 1024 + 3, 0);

    await expect(
      importDesignResumeFromFile(
        pdfInput({ dataBase64: overLimitPayload.toString("base64") }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Resume files must be 10 MB or smaller.",
    });
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("rejects invalid base64 payloads before reading or sending them", async () => {
    await expect(
      importDesignResumeFromFile(
        pdfInput({ dataBase64: "not-valid-base64!!!" }),
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Resume file data must be valid base64.",
    });

    expect(pdfParseMock).not.toHaveBeenCalled();
    expect(callJsonMock).not.toHaveBeenCalled();
    expect(
      designResumeService.replaceCurrentDesignResumeDocument,
    ).not.toHaveBeenCalled();
  });

  it("decodes base64 that contains whitespace", async () => {
    const compactBase64 = Buffer.from("pdf-data").toString("base64");
    const spacedBase64 = `${compactBase64.slice(0, 4)}\n${compactBase64.slice(4)}  `;

    await importDesignResumeFromFile(pdfInput({ dataBase64: spacedBase64 }));

    const parsedBuffer = pdfParseMock.mock.calls[0]?.[0] as Buffer;
    expect(Buffer.isBuffer(parsedBuffer)).toBe(true);
    expect(parsedBuffer.toString("utf8")).toBe("pdf-data");
  });

  it("rejects PDFs without selectable text before calling Claude", async () => {
    pdfParseMock.mockResolvedValue({ text: "   " } as never);

    await expect(importDesignResumeFromFile(pdfInput())).rejects.toMatchObject({
      status: 400,
      message: "Resume PDF did not contain readable text.",
    });
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("rejects PDFs that cannot be read", async () => {
    pdfParseMock.mockRejectedValue(new Error("Encrypted PDF"));

    await expect(importDesignResumeFromFile(pdfInput())).rejects.toMatchObject({
      status: 400,
      message: "Resume PDF file could not be read or is encrypted.",
    });
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("surfaces Claude CLI failures as upstream errors without saving", async () => {
    callJsonMock.mockRejectedValue(
      new Error(
        "Claude CLI was not found in PATH. Install Claude Code or set CLAUDE_CLI_BIN.",
      ),
    );

    let thrown: unknown;
    try {
      await importDesignResumeFromFile(pdfInput());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
      message:
        "Claude CLI was not found in PATH. Install Claude Code or set CLAUDE_CLI_BIN.",
      details: { model: "opus:medium", requestId: "req-123" },
    });
    expect(
      designResumeService.replaceCurrentDesignResumeDocument,
    ).not.toHaveBeenCalled();
  });

  it("reports an empty Claude answer as an upstream error", async () => {
    callJsonMock.mockResolvedValue({ text: "   " });

    await expect(importDesignResumeFromFile(pdfInput())).rejects.toMatchObject({
      status: 502,
      message: "Claude returned an empty response while reading your CV.",
    });
    expect(
      designResumeService.replaceCurrentDesignResumeDocument,
    ).not.toHaveBeenCalled();
  });
});
