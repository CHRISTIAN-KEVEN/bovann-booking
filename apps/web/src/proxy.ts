import { NextResponse, type NextRequest } from 'next/server';

/**
 * Language routing. French is served at the plain address and English under `/en`:
 * - `/reserver/date`     → shown from the `[lang]=fr` route (rewrite, the address stays)
 * - `/en/reserver/date`  → the `[lang]=en` route as is
 * - `/fr/reserver/date`  → redirected to `/reserver/date`, so each page has one address
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/en' || pathname.startsWith('/en/')) return NextResponse.next();
  if (pathname === '/fr' || pathname.startsWith('/fr/')) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || '/';
    return NextResponse.redirect(url, 308);
  }
  const url = request.nextUrl.clone();
  url.pathname = `/fr${pathname === '/' ? '' : pathname}`;
  url.search = search;
  return NextResponse.rewrite(url);
}

export const config = {
  // Not the API, Next's own files, or files with an extension (icon.svg, robots.txt…).
  matcher: ['/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)'],
};
