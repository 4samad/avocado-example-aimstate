import type { NextPage } from "next";
import { CONSTITUTION } from "~~/lib/constitution";

const ConstitutionPage: NextPage = () => {
  return (
    <div className="flex flex-col items-center grow pt-10 px-4 pb-16">
      <div className="max-w-2xl w-full">
        <h1 className="text-3xl font-bold mb-8">Constitution</h1>
        <div className="card bg-base-200">
          <div className="card-body py-6 px-8">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-base-content/80">
              {CONSTITUTION}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConstitutionPage;
