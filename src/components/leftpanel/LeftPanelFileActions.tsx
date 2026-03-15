import { IconFolderOpen, IconSave, IconX } from "../icons/EwrIcons";

export type LeftPanelFileActionsProps = {
  title: string;
  subtitle: string;

  loadFromData?: {
    disabled?: boolean;
    title?: string;
    onClick: () => void;
    label?: string;
  };

  closeFile: {
    onClick: () => void;
    label?: string;
    disabled?: boolean;
    title?: string;
  };

  saveFile: {
    disabled?: boolean;
    title?: string;
    onClick: () => void;
    label?: string;
  };
};

export default function LeftPanelFileActions(props: LeftPanelFileActionsProps) {
  const load = props.loadFromData;

  return (
    <div className="ewr-leftTopGridAreas">
      <div className="ewr-leftContext">
        <div className="ewr-leftContextTitle">{props.title}</div>
        <div className="ewr-leftContextSub">{props.subtitle}</div>
      </div>

      <div className="ewr-leftTopLoad">
        <button
          type="button"
          className={`ewr-button ewr-buttonLightBlue ewr-buttonWide ${load?.disabled ? "ewr-buttonDisabled" : ""}`}
          disabled={!!load?.disabled}
          onClick={load?.onClick}
          title={load?.title}
        >
          <IconFolderOpen className="btnSvg" />
          <span className="btnText">{load?.label ?? "Load from DATA"}</span>
        </button>
      </div>

      <div className="ewr-leftTopOpen">
        <button
          type="button"
          className={`ewr-button ewr-buttonRed ewr-buttonWide ${props.closeFile.disabled ? "ewr-buttonDisabled" : ""}`}
          disabled={!!props.closeFile.disabled}
          onClick={props.closeFile.onClick}
          title={props.closeFile.title}
        >
          <IconX className="btnSvg" />
          <span className="btnText">{props.closeFile.label ?? "Close File"}</span>
        </button>
      </div>

      <div className="ewr-leftTopSave">
        <button
          type="button"
          className={`ewr-button ewr-buttonGreen ewr-buttonWide ${props.saveFile.disabled ? "ewr-buttonDisabled" : ""}`}
          disabled={!!props.saveFile.disabled}
          onClick={props.saveFile.onClick}
          title={props.saveFile.title}
        >
          <IconSave className="btnSvg" />
          <span className="btnText">{props.saveFile.label ?? "Save File"}</span>
        </button>
      </div>
    </div>
  );
}
