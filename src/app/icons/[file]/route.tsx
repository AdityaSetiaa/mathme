import { appIcon } from "@/lib/app-icon";

const SIZES = { "192.png": 192, "512.png": 512 } as const;

export const dynamicParams = false;
export const generateStaticParams = () => Object.keys(SIZES).map((file) => ({ file }));

export async function GET(_req: Request, { params }: RouteContext<"/icons/[file]">) {
  return appIcon(SIZES[(await params).file as keyof typeof SIZES]);
}
