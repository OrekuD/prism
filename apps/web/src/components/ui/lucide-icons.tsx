/**
 * Lucide-compatible icon API over Hugeicons (free stroke-rounded set).
 *
 * The redesign switches iconography to Hugeicons; call sites keep their
 * lucide-style usage (same export names, same `className`/`size`/aria
 * props), so this module is the only place mapping names.
 *
 * strokeWidth stays at Hugeicons' 1.5 default to match the redesigned
 * stroke aesthetic (lucide's default was 2). Glyph imports are aliased
 * with a `Glyph` suffix where the hugeicons name collides with a
 * lucide-compatible export below.
 */
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Activity01Icon,
  Add01Icon,
  Alert01Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
  BanIcon,
  Cancel01Icon,
  CheckmarkCircle01Icon,
  ChevronDownIcon as ChevronDownGlyph,
  ChevronLeftIcon as ChevronLeftGlyph,
  ChevronRightIcon as ChevronRightGlyph,
  ChevronUpIcon as ChevronUpGlyph,
  ChevronsLeftIcon as ChevronsLeftGlyph,
  ChevronsRightIcon as ChevronsRightGlyph,
  CircleIcon as CircleGlyph,
  Comment01Icon,
  ComputerIcon,
  Copy01Icon,
  Delete02Icon,
  Download04Icon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  File02Icon as File02Glyph,
  FileCodeIcon as FileCodeGlyph,
  FlashIcon,
  Globe02Icon,
  GlobeIcon,
  InformationCircleIcon,
  Key01Icon,
  Loading03Icon,
  Logout01Icon,
  Menu01Icon,
  Message01Icon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Moon02Icon,
  OctagonXIcon as OctagonXGlyph,
  PartyIcon,
  PencilIcon,
  Refresh01Icon,
  Rotate01Icon as Rotate01Glyph,
  Search01Icon,
  SearchRemoveIcon,
  ServerStack01Icon,
  Shield02Icon,
  SmartPhone01Icon,
  SparklesIcon,
  SquareIcon,
  Sun03Icon,
  BarChartIcon as BarChartGlyph,
  Folder01Icon,
  Settings01Icon,
  Tick01Icon,
  UserAdd01Icon,
  UserGroupIcon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type React from "react";
import { cn } from "@/lib/utils";

export type IconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
};

function Icon({
  icon,
  size = 24,
  strokeWidth,
  className,
  ...rest
}: IconProps & { icon: IconSvgElement }) {
  return (
    <HugeiconsIcon
      icon={icon}
      size={size}
      strokeWidth={typeof strokeWidth === "number" ? strokeWidth : undefined}
      className={cn("shrink-0", className)}
      {...rest}
    />
  );
}

export function Activity(props: IconProps) {
  return <Icon icon={Activity01Icon} {...props} />;
}
export function AlertCircle(props: IconProps) {
  return <Icon icon={AlertCircleIcon} {...props} />;
}
export function AlertTriangle(props: IconProps) {
  return <Icon icon={Alert01Icon} {...props} />;
}
export function ArrowLeft(props: IconProps) {
  return <Icon icon={ArrowLeft01Icon} {...props} />;
}
export function Ban(props: IconProps) {
  return <Icon icon={BanIcon} {...props} />;
}
export function Chart(props: IconProps) {
  return <Icon icon={BarChartGlyph} {...props} />;
}
export function Folder(props: IconProps) {
  return <Icon icon={Folder01Icon} {...props} />;
}
export function Settings(props: IconProps) {
  return <Icon icon={Settings01Icon} {...props} />;
}
export function Check(props: IconProps) {
  return <Icon icon={Tick01Icon} {...props} />;
}
export function CheckIcon(props: IconProps) {
  return <Icon icon={Tick01Icon} {...props} />;
}
export function ChevronDown(props: IconProps) {
  return <Icon icon={ChevronDownGlyph} {...props} />;
}
export function ChevronDownIcon(props: IconProps) {
  return <Icon icon={ChevronDownGlyph} {...props} />;
}
export function ChevronLeft(props: IconProps) {
  return <Icon icon={ChevronLeftGlyph} {...props} />;
}
export function ChevronLeftIcon(props: IconProps) {
  return <Icon icon={ChevronLeftGlyph} {...props} />;
}
export function ChevronRight(props: IconProps) {
  return <Icon icon={ChevronRightGlyph} {...props} />;
}
export function ChevronRightIcon(props: IconProps) {
  return <Icon icon={ChevronRightGlyph} {...props} />;
}
export function ChevronUpIcon(props: IconProps) {
  return <Icon icon={ChevronUpGlyph} {...props} />;
}
export function ChevronsLeft(props: IconProps) {
  return <Icon icon={ChevronsLeftGlyph} {...props} />;
}
export function ChevronsRight(props: IconProps) {
  return <Icon icon={ChevronsRightGlyph} {...props} />;
}
export function CircleCheckIcon(props: IconProps) {
  return <Icon icon={CheckmarkCircle01Icon} {...props} />;
}
export function CircleIcon(props: IconProps) {
  return <Icon icon={CircleGlyph} {...props} />;
}
export function Computer(props: IconProps) {
  return <Icon icon={ComputerIcon} {...props} />;
}
export function Copy(props: IconProps) {
  return <Icon icon={Copy01Icon} {...props} />;
}
export function Download(props: IconProps) {
  return <Icon icon={Download04Icon} {...props} />;
}
export function ExternalLink(props: IconProps) {
  return <Icon icon={ExternalLinkIcon} {...props} />;
}
export function Eye(props: IconProps) {
  return <Icon icon={EyeIcon} {...props} />;
}
export function EyeOff(props: IconProps) {
  return <Icon icon={EyeOffIcon} {...props} />;
}
export function FileJson(props: IconProps) {
  return <Icon icon={FileCodeGlyph} {...props} />;
}
export function FileText(props: IconProps) {
  return <Icon icon={File02Glyph} {...props} />;
}
export function Globe(props: IconProps) {
  return <Icon icon={Globe02Icon} {...props} />;
}
export function Info(props: IconProps) {
  return <Icon icon={InformationCircleIcon} {...props} />;
}
export function InfoIcon(props: IconProps) {
  return <Icon icon={InformationCircleIcon} {...props} />;
}
export function KeyRound(props: IconProps) {
  return <Icon icon={Key01Icon} {...props} />;
}
export function Loader2(props: IconProps) {
  return <Icon icon={Loading03Icon} {...props} />;
}
export function Loader2Icon(props: IconProps) {
  return <Icon icon={Loading03Icon} {...props} />;
}
export function LogOut(props: IconProps) {
  return <Icon icon={Logout01Icon} {...props} />;
}
export function Menu(props: IconProps) {
  return <Icon icon={Menu01Icon} {...props} />;
}
export function MessageSquareText(props: IconProps) {
  return <Icon icon={Message01Icon} {...props} />;
}
export function MinusIcon(props: IconProps) {
  return <Icon icon={MinusSignIcon} {...props} />;
}
export function Monitor(props: IconProps) {
  return <Icon icon={ComputerIcon} {...props} />;
}
export function MonitorCloud(props: IconProps) {
  return <Icon icon={Globe02Icon} {...props} />;
}
export function Moon(props: IconProps) {
  return <Icon icon={Moon02Icon} {...props} />;
}
export function MoreHorizontal(props: IconProps) {
  return <Icon icon={MoreHorizontalIcon} {...props} />;
}
export function OctagonXIcon(props: IconProps) {
  return <Icon icon={OctagonXGlyph} {...props} />;
}
export function PartyPopper(props: IconProps) {
  return <Icon icon={PartyIcon} {...props} />;
}
export function Pencil(props: IconProps) {
  return <Icon icon={PencilIcon} {...props} />;
}
export function Plus(props: IconProps) {
  return <Icon icon={Add01Icon} {...props} />;
}
export function RefreshCw(props: IconProps) {
  return <Icon icon={Refresh01Icon} {...props} />;
}
export function RotateCcw(props: IconProps) {
  return <Icon icon={Rotate01Glyph} {...props} />;
}
export function Search(props: IconProps) {
  return <Icon icon={Search01Icon} {...props} />;
}
export function SearchIcon(props: IconProps) {
  return <Icon icon={Search01Icon} {...props} />;
}
export function SearchX(props: IconProps) {
  return <Icon icon={SearchRemoveIcon} {...props} />;
}
export function Server(props: IconProps) {
  return <Icon icon={ServerStack01Icon} {...props} />;
}
export function ShieldCheck(props: IconProps) {
  return <Icon icon={Shield02Icon} {...props} />;
}
export function Smartphone(props: IconProps) {
  return <Icon icon={SmartPhone01Icon} {...props} />;
}
export function Sparkles(props: IconProps) {
  return <Icon icon={SparklesIcon} {...props} />;
}
export function Square(props: IconProps) {
  return <Icon icon={SquareIcon} {...props} />;
}
export function Sun(props: IconProps) {
  return <Icon icon={Sun03Icon} {...props} />;
}
export function Trash2(props: IconProps) {
  return <Icon icon={Delete02Icon} {...props} />;
}
export function TriangleAlert(props: IconProps) {
  return <Icon icon={Alert01Icon} {...props} />;
}
export function TriangleAlertIcon(props: IconProps) {
  return <Icon icon={Alert01Icon} {...props} />;
}
export function User(props: IconProps) {
  return <Icon icon={UserIcon} {...props} />;
}
export function UserPlus(props: IconProps) {
  return <Icon icon={UserAdd01Icon} {...props} />;
}
export function Users(props: IconProps) {
  return <Icon icon={UserGroupIcon} {...props} />;
}
export function X(props: IconProps) {
  return <Icon icon={Cancel01Icon} {...props} />;
}
export function XIcon(props: IconProps) {
  return <Icon icon={Cancel01Icon} {...props} />;
}
export function Zap(props: IconProps) {
  return <Icon icon={FlashIcon} {...props} />;
}
