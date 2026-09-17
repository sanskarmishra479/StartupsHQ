import {
  categoryMetadata,
  categoryPage,
  categoryStaticParams,
} from "../../_lib/category-route";

// FR-108: /categories/work-type/[slug].

export const generateStaticParams = categoryStaticParams("work-type");
export const generateMetadata = categoryMetadata("work-type");
export default categoryPage("work-type");
