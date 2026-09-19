// ThermaSight — icon set. Material Symbols outlined (the template's icon
// family), loaded as React components via vite-plugin-svgr, fill currentColor.
import type { ReactNode, SVGProps } from "react";
import AddRaw from "@material-symbols/svg-400/outlined/add.svg?react";
import CancelRaw from "@material-symbols/svg-400/outlined/cancel.svg?react";
import CheckRaw from "@material-symbols/svg-400/outlined/check.svg?react";
import CheckCircleRaw from "@material-symbols/svg-400/outlined/check_circle.svg?react";
import ChevronLeftRaw from "@material-symbols/svg-400/outlined/chevron_left.svg?react";
import ChevronRightRaw from "@material-symbols/svg-400/outlined/chevron_right.svg?react";
import CircleRaw from "@material-symbols/svg-400/outlined/circle.svg?react";
import CloseRaw from "@material-symbols/svg-400/outlined/close.svg?react";
import FolderRaw from "@material-symbols/svg-400/outlined/folder.svg?react";
import InfoRaw from "@material-symbols/svg-400/outlined/info.svg?react";
import KeepRaw from "@material-symbols/svg-400/outlined/keep-fill.svg?react";
import KeyboardArrowDownRaw from "@material-symbols/svg-400/outlined/keyboard_arrow_down.svg?react";
import SearchRaw from "@material-symbols/svg-400/outlined/search.svg?react";
import UnfoldMoreRaw from "@material-symbols/svg-400/outlined/unfold_more.svg?react";
import WarningRaw from "@material-symbols/svg-400/outlined/warning.svg?react";

type IconProps = { className?: string; label?: string } & SVGProps<SVGSVGElement>;

const wrap =
  (C: (p: IconProps) => ReactNode | Promise<ReactNode>) =>
  ({ className = "h-4 w-4", label, ...rest }: IconProps) => (
    <C className={className} fill="currentColor" aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label} {...rest} />
  );

export const IconAdd = wrap(AddRaw);
export const IconCancel = wrap(CancelRaw);
export const IconCheck = wrap(CheckRaw);
export const IconCheckCircle = wrap(CheckCircleRaw);
export const IconChevronLeft = wrap(ChevronLeftRaw);
export const IconChevronRight = wrap(ChevronRightRaw);
export const IconCircle = wrap(CircleRaw);
export const IconClose = wrap(CloseRaw);
export const IconFolder = wrap(FolderRaw);
export const IconInfo = wrap(InfoRaw);
export const IconPin = wrap(KeepRaw);
export const IconChevronDown = wrap(KeyboardArrowDownRaw);
export const IconSearch = wrap(SearchRaw);
export const IconUnfold = wrap(UnfoldMoreRaw);
export const IconWarning = wrap(WarningRaw);