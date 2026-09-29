import { NextRequest, NextResponse } from "next/server";
import { supabase, fetchAllRows } from "@/lib/supabase";

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const project = searchParams.get("project") || "all";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const leads = await fetchAllRows<Record<string, unknown>>(() => {
      let query = supabase.from("leads").select("*");
      if (project !== "all") query = query.eq("project_name", project);
      if (startDate) query = query.gte("created_time", startDate);
      // endDate is an exclusive upper bound (start of the following day)
      if (endDate) query = query.lt("created_time", endDate);
      return query
        .order("created_time", { ascending: false })
        .order("lead_id", { ascending: true }) as never;
    });

    return NextResponse.json({ success: true, leads });
  } catch (err) {
    console.error("[api/leads] Error:", errorMessage(err));
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !status || typeof status !== "string") {
      return NextResponse.json({ success: false, error: "Missing id or status" }, { status: 400 });
    }

    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[api/leads PUT] Error:", errorMessage(err));
    return NextResponse.json({ success: false, error: errorMessage(err) }, { status: 500 });
  }
}
