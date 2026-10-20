import { notFound, redirect } from "next/navigation";
import { nativeRouteAlias, type NativeRouteQuery, type NativeRouteSection } from "@/lib/native-route-alias";

export interface NativeAliasPageProps {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<NativeRouteQuery>;
}

/** Redirect only after resolving both Next.js route inputs, retaining all query values. */
export default async function NativeRouteAliasPage({ section, params, searchParams }: NativeAliasPageProps & { section: NativeRouteSection }) {
  const [route, query] = await Promise.all([params, searchParams]);
  const destination = nativeRouteAlias(section, route.path ?? [], query);
  if (!destination) notFound();
  return redirect(destination);
}
