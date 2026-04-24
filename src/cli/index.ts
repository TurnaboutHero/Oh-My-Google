import { Command } from "commander";
import { authCommand } from "./auth.js";
import { approvalsCommand } from "./commands/approvals.js";
import { approveCommand } from "./commands/approve.js";
import { budgetCommand } from "./commands/budget.js";
import { deployCommand } from "./commands/deploy.js";
import { firebaseCommand } from "./commands/firebase.js";
import { iamCommand } from "./commands/iam.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { mcpCommand } from "./commands/mcp.js";
import { projectCommand } from "./commands/project.js";
import { rejectCommand } from "./commands/reject.js";
import { secretCommand } from "./commands/secret.js";
import { securityCommand } from "./commands/security.js";
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
program.addCommand(approveCommand);
program.addCommand(rejectCommand);
program.addCommand(approvalsCommand);
program.addCommand(budgetCommand);
program.addCommand(secretCommand);
program.addCommand(doctorCommand);
program.addCommand(projectCommand);
program.addCommand(setupCommand);
program.addCommand(authCommand);
program.addCommand(firebaseCommand);
program.addCommand(iamCommand);
program.addCommand(securityCommand);
program.addCommand(mcpCommand);

program.parse();
