import fs from "node:fs";
import path from "node:path";
import { log } from "./log";

interface Entry {
  fetchedAt: string;
  response: unknown;
}

/**
 * Tiny persistent key -> JSON cache backed by a single file. Reads happen once at startup;
 * writes are serialised and atomic (temp file + rename) so a crash can't corrupt it.
 * Commit the file after warming it and the demo never needs a live SerpApi call.
 */
export class JsonFileCache {
  private data: Record<string, Entry> = {};
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {
    try {
      if (fs.existsSync(file)) {
        this.data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Entry>;
        log.info("cache", `loaded ${Object.keys(this.data).length} entries from ${file}`);
      }
    } catch (e) {
      log.warn("cache", `could not read ${file}, starting empty: ${e instanceof Error ? e.message : e}`);
      this.data = {};
    }
  }

  get size() {
    return Object.keys(this.data).length;
  }

  get(key: string): unknown | undefined {
    return this.data[key]?.response;
  }

  set(key: string, response: unknown): Promise<void> {
    this.data[key] = { fetchedAt: new Date().toISOString(), response };
    return this.flush();
  }

  /** Resolves once everything set so far is on disk. */
  flush(): Promise<void> {
    this.writing = this.writing.then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 1));
        await fs.promises.rename(tmp, this.file);
      } catch (e) {
        log.warn("cache", `write failed: ${e instanceof Error ? e.message : e}`);
      }
    });
    return this.writing;
  }
}
