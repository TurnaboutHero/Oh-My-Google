import { Command } from "commander";
import { authCommand } from "./auth.js";
import { deployCommand } from "./commands/deploy.js";
import { firebaseCommand } from "./commands/firebase.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { doctorCommand } from "./doctor.js";
import { setOutputFormat } from "./output.js";
import { setupCommand } from "./setup.js";

const program = new Command();

program
  .name("omg")
  .description("oh-my-google - agent-first harness for the Google ecosystem")
  .version("0.1.0")
  .option("--output <format>", "Output format: human or json", "human")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.output === "json") {
      setOutputFormat("json");
    } else {
      setOutputFormat("human");
    }
  });

program.addCommand(initCommand);
program.addCommand(linkCommand);
program.addCommand(deployCommand);
program.addCommand(doctorCommand);
program.addCommand(setupCommand);
program.addCommand(authCommand);
program.addCommand(firebaseCommand);

program.parse();
