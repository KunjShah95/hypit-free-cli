import type { CliCommandModule } from "@hypit/hypit/cli";

import { runGenerateCli, writeGenerateHelp } from "./generate.js";
import { runVocabularyCli, writeVocabularyHelp } from "./vocabulary.js";

/** The Video application owns its installed author-vocabulary view and its one-shot generation. */
export const cliCommandModules = [{
  format: "hypit.cli-command@1",
  id: "@hypit/video",
  commands: ["vocabulary", "generate"],
  writeRootHelp(io) {
    io.write("\nVideo author vocabulary\n  vocabulary\n  hypit vocabulary --help for package and Surface inspection\n"
      + "\nOne-shot generation\n  generate\n  hypit generate --help for the exact models and options\n");
  },
  writeHelp(argv, io) {
    if (argv[0] === "generate") { writeGenerateHelp(io); return; }
    writeVocabularyHelp(io);
  },
  async run(argv, io, context) {
    if (argv[0] === "generate") {
      await runGenerateCli(argv, io, context);
      return;
    }
    await runVocabularyCli(argv, io, context.cwd, context.distribution.packageRoot);
  },
}] as const satisfies readonly CliCommandModule[];
