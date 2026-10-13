import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { JobInfo } from "../api/types";
import { makeProject, mockFetch } from "../test/fixtures";
import JobProgress from "./JobProgress";

const job: JobInfo = {
  id: "job-1",
  kind: "render_clips",
  status: "running",
  progress: 0.42,
  message: "Corte 1 de 2",
  error: null,
  created_at: "2026-10-10T12:00:00Z",
  started_at: "2026-10-10T12:00:01Z",
  finished_at: null,
};

describe("JobProgress", () => {
  it("mostra o progresso real e cancela a tarefa", async () => {
    const user = userEvent.setup();
    const project = makeProject({ status: "rendering", job });
    const cancelled = { ...project, status: "cancelled" as const, job: { ...job, status: "cancelled" as const } };
    const { fn, calls } = mockFetch({ [`POST /api/projects/${project.id}/cancel`]: () => ({ body: cancelled }) });
    vi.stubGlobal("fetch", fn);
    const onChange = vi.fn();
    render(<JobProgress project={project} onChange={onChange} />);
    expect(screen.getByText(/Corte 1 de 2/)).toBeInTheDocument();
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Cancelar/ }));
    expect(calls.map((c) => c.key)).toContain(`POST /api/projects/${project.id}/cancel`);
    expect(onChange).toHaveBeenCalledWith(cancelled);
  });

  it("informa o erro ao cancelar e não aparece sem tarefa ativa", async () => {
    const user = userEvent.setup();
    const project = makeProject({ status: "rendering", job });
    vi.stubGlobal("fetch", mockFetch({ [`POST /api/projects/${project.id}/cancel`]: () => ({ status: 409, body: { detail: "Nada a cancelar." } }) }).fn);
    const onError = vi.fn();
    const { rerender, container } = render(<JobProgress project={project} onError={onError} />);
    await user.click(screen.getByRole("button", { name: /Cancelar/ }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Nada a cancelar."));
    rerender(<JobProgress project={makeProject()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
