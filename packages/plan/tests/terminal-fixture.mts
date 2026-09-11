import { initTheme } from "@earendil-works/pi-coding-agent";
import { Editor, ProcessTerminal, TuiMainScreen } from "@earendil-works/pi-tui";

const plain = (text: string) => text;

export function testEditor(): Editor {
  initTheme("dark", false);
  return new Editor(new TuiMainScreen(new ProcessTerminal()), {
    borderColor: plain,
    selectList: {
      selectedPrefix: plain,
      selectedText: plain,
      description: plain,
      scrollInfo: plain,
      noMatch: plain,
    },
  });
}
