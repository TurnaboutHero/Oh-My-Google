import { Command } from "commander";
import { setOutputFormat } from "./output.js";
import { setupCommand } from "./setup.js";
import { authCommand } from "./auth.js";
import { doctorCommand } from "./doctor.js";
import { deployCommand } from "./commands/deploy.js";
import { firebaseCommand } from "./commands/firebase.js";

const program = new Command();

program
  .name("omg")
  .description("oh-my-google — agent-first harness for Google ecosystem")
  .version("0.1.0")
  .option("--output <format>", "Output format: human or json", "human")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.output === "json") {
      setOutputFormat("json");
    }
  });

program.addCommand(setupCommand);
program.addCommand(authCommand);
program.addCommand(doctorCommand);
program.addCommand(deployCommand);
program.addCommand(firebaseCommand);

program.parse();
